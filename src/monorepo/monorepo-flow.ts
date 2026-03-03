import path from 'path';
import chalk from 'chalk';
import clack from '../utils/clack';
import { withSilentOutput } from '../utils/clack';
import { logToFile, withLogFile } from '../utils/debug';
import { analytics } from '../utils/analytics';
import { FRAMEWORK_REGISTRY } from '../lib/registry';
import {
  runAgentWizard,
  runSharedSetup,
  runPreflight,
  type SharedSetupData,
  type PreflightData,
} from '../lib/agent-runner';
import {
  addMCPServerToClientsStep,
  uploadEnvironmentVariablesStep,
} from '../steps';
import { abortIfCancelled } from '../utils/clack-utils';
import {
  detectWorkspaces,
  type WorkspaceType,
} from '../utils/workspace-detection';
import { isLikelyApp } from '../utils/app-detection';
import { hasPostHogInstalled } from '../utils/posthog-detection';
import { detectIntegration } from '../run';
import { Integration } from '../lib/constants';
import type { WizardOptions } from '../utils/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DetectedProject = {
  dir: string;
  relativePath: string;
  integration: Integration;
  frameworkName: string;
  alreadyConfigured: boolean;
  /** URL-safe slug derived from relativePath, computed once. */
  slug: string;
};

type ProjectResult = {
  project: DetectedProject;
  success: boolean;
  error?: string;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type WorkspaceDetectionResult = {
  projects: DetectedProject[];
  workspaceType: WorkspaceType;
};

/** Detect workspace members and their frameworks. Returns null if not a monorepo. */
export async function detectWorkspaceProjects(
  options: WizardOptions,
): Promise<WorkspaceDetectionResult | null> {
  const workspace = await detectWorkspaces(options.installDir);
  if (!workspace) {
    return null;
  }

  logToFile(
    `[Monorepo] Detected ${workspace.type} workspace with ${workspace.memberDirs.length} members`,
  );

  const results = await Promise.all(
    workspace.memberDirs.map(async (memberDir) => {
      const integration = await detectIntegration({
        installDir: memberDir,
        workspaceRootDir: workspace.rootDir,
      });
      if (!integration) return null;

      // Filter out library packages for generic language-level integrations
      if (!(await isLikelyApp(memberDir, integration))) {
        logToFile(
          `[Monorepo] Skipping ${path.relative(
            options.installDir,
            memberDir,
          )} — detected as ${integration} but appears to be a library`,
        );
        return null;
      }

      const config = FRAMEWORK_REGISTRY[integration];
      const alreadyConfigured = await hasPostHogInstalled(memberDir);
      const relativePath = path.relative(options.installDir, memberDir);
      const slug = relativePath.replace(/[^a-zA-Z0-9-]/g, '-') || 'root';

      return {
        dir: memberDir,
        relativePath,
        integration,
        frameworkName: config.metadata.name,
        alreadyConfigured,
        slug,
      } as DetectedProject;
    }),
  );

  const projects = results.filter((r): r is DetectedProject => r !== null);
  return { projects, workspaceType: workspace.type };
}

/** Run the monorepo flow: preparation (sequential) → instrumentation (concurrent) → post-flight. */
export async function runMonorepoFlow(
  projects: DetectedProject[],
  options: WizardOptions,
  workspaceType?: WorkspaceType,
): Promise<void> {
  clack.log.info(
    `Detected a monorepo with ${chalk.cyan(String(projects.length))} projects`,
  );

  // Let user select which projects to set up
  const selected = await selectMonorepoProjects(projects, options);

  if (selected.length === 0) {
    clack.log.warn('No projects selected.');
    clack.outro('PostHog wizard will see you next time!');
    return;
  }

  analytics.setTag('monorepo', 'true');
  analytics.setTag('monorepo_projects_detected', String(projects.length));
  analytics.setTag('monorepo_projects_selected', String(selected.length));

  // Run shared setup once (AI consent, region, git check, OAuth)
  const sharedSetup = await runSharedSetup(options);

  // Benchmark mode: fall back to sequential execution
  if (options.benchmark) {
    clack.log.warn(
      'Benchmark mode enabled — running projects sequentially (benchmark middleware uses global log path)',
    );
    await runMonorepoSequential(selected, options, sharedSetup);
    return;
  }

  // ── Phase 1: Preparation (sequential) ─────────────────────────────────
  clack.log.info(
    `Gathering context for ${chalk.cyan(String(selected.length))} project${
      selected.length > 1 ? 's' : ''
    }...`,
  );

  type PreflightResult = {
    project: DetectedProject;
    preflight: PreflightData;
    config: (typeof FRAMEWORK_REGISTRY)[Integration];
    projectOptions: WizardOptions;
  };

  const preflightResults: PreflightResult[] = [];

  for (const project of selected) {
    const config = FRAMEWORK_REGISTRY[project.integration];
    const projectOptions: WizardOptions = {
      ...options,
      installDir: project.dir,
      workspaceRootDir: options.installDir,
      cloudRegion: sharedSetup.cloudRegion,
    };

    clack.log.step(
      `Preparing ${chalk.bold(project.frameworkName)} in ${chalk.cyan(
        project.relativePath,
      )}`,
    );

    try {
      const preflight = await runPreflight(config, projectOptions);
      if (preflight) {
        preflightResults.push({ project, preflight, config, projectOptions });
      } else {
        logToFile(
          `[Monorepo] Skipping ${project.relativePath} — preparation returned null (e.g. unsupported version)`,
        );
        clack.log.warn(
          `Skipping ${project.frameworkName} in ${project.relativePath}`,
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logToFile(
        `[Monorepo] Preparation error for ${project.relativePath}: ${errorMessage}`,
      );
      clack.log.error(
        `Setup failed for ${project.frameworkName} in ${
          project.relativePath
        }: ${chalk.red(errorMessage)}`,
      );
    }
  }

  if (preflightResults.length === 0) {
    clack.log.warn('No projects ready to set up.');
    clack.outro('PostHog wizard will see you next time!');
    await analytics.shutdown('error');
    return;
  }

  // ── Phase 2: Concurrent agent execution ───────────────────────────────
  const total = preflightResults.length;

  const progressSpinner = clack.spinner();
  progressSpinner.start(`Instrumenting ${total} projects (0/${total} done)`);

  let completed = 0;

  // Use Promise.allSettled for deterministic result ordering
  const settledResults = await Promise.allSettled(
    preflightResults.map(({ project, preflight, config, projectOptions }) => {
      const projectLogPath = `/tmp/posthog-wizard-${project.slug}.log`;

      return withLogFile(projectLogPath, () =>
        withSilentOutput(async () => {
          try {
            await runAgentWizard(config, projectOptions, {
              sharedSetup,
              skipPostAgent: true,
              concurrentFence: true,
              preflight,
              additionalContext: workspaceType
                ? [`This project is part of a ${workspaceType} monorepo.`]
                : undefined,
              onStatus: (statusMessage: string) => {
                const label = project.relativePath || project.frameworkName;
                progressSpinner.stop(`${chalk.cyan(label)}: ${statusMessage}`);
                progressSpinner.start(
                  `Instrumenting ${total} projects (${completed}/${total} done)`,
                );
              },
            });
            return { project, success: true } as ProjectResult;
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            logToFile(
              `[Monorepo] Agent error for ${project.relativePath}: ${errorMessage}`,
            );
            return {
              project,
              success: false,
              error: errorMessage,
            } as ProjectResult;
          } finally {
            // Update progress spinner — progressSpinner is the real clack
            // spinner captured before entering silent mode, so .message()
            // still writes to stdout even inside withSilentOutput.
            completed++;
            const label = project.relativePath || project.frameworkName;
            progressSpinner.message(
              `${completed}/${total} done (latest: ${label})`,
            );
          }
        }),
      );
    }),
  );

  progressSpinner.stop(
    `All ${chalk.cyan(String(total))} projects instrumented`,
  );

  // Extract results in order (allSettled preserves input order)
  const results: ProjectResult[] = settledResults.map((settled, i) => {
    if (settled.status === 'fulfilled') {
      return settled.value;
    }
    // Should not happen since we catch inside, but handle defensively
    return {
      project: preflightResults[i].project,
      success: false,
      error:
        settled.reason instanceof Error
          ? settled.reason.message
          : 'Unknown error',
    };
  });

  // Print per-project results
  for (const result of results) {
    const label = result.project.relativePath
      ? `${chalk.bold(result.project.frameworkName)} in ${chalk.cyan(
          result.project.relativePath,
        )}`
      : chalk.bold(result.project.frameworkName);
    const logPath = chalk.dim(`/tmp/posthog-wizard-${result.project.slug}.log`);
    if (result.success) {
      clack.log.success(`${label}\n│  Log: ${logPath}`);
    } else {
      clack.log.error(
        `${label} — ${chalk.red(
          result.error ?? 'Unknown error',
        )}\n│  Log: ${logPath}`,
      );
    }
  }

  // ── Phase 3: Post-flight (sequential) ─────────────────────────────────
  await runPostFlight(results, sharedSetup, options);

  printMonorepoSummary(results);

  const allSucceeded = results.every((r) => r.success);
  await analytics.shutdown(allSucceeded ? 'success' : 'error');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Sequential monorepo execution (benchmark mode fallback). */
async function runMonorepoSequential(
  selected: DetectedProject[],
  options: WizardOptions,
  sharedSetup: SharedSetupData,
): Promise<void> {
  clack.log.info(
    `Setting up ${chalk.cyan(String(selected.length))} project${
      selected.length > 1 ? 's' : ''
    } sequentially`,
  );

  const results: ProjectResult[] = [];

  for (let i = 0; i < selected.length; i++) {
    const project = selected[i];
    const projectNumber = i + 1;
    const totalProjects = selected.length;

    clack.log.step(
      `\n${chalk.cyan(
        `[${projectNumber}/${totalProjects}]`,
      )} Setting up PostHog for ${chalk.bold(
        project.frameworkName,
      )} in ${chalk.cyan(project.relativePath)}`,
    );

    const projectOptions: WizardOptions = {
      ...options,
      installDir: project.dir,
      workspaceRootDir: options.installDir,
      cloudRegion: sharedSetup.cloudRegion,
    };

    const config = FRAMEWORK_REGISTRY[project.integration];

    // Clear framework-specific tags from previous project to prevent leakage
    if (i > 0) {
      const prevIntegration = selected[i - 1].integration;
      analytics.clearTagsWithPrefix(`${prevIntegration}-`);
    }
    analytics.setTag('integration', project.integration);

    try {
      await runAgentWizard(config, projectOptions, { sharedSetup });
      results.push({ project, success: true });
      clack.log.success(
        chalk.dim(`✓ ${projectNumber}/${totalProjects} complete`),
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logToFile(
        `[Monorepo] Error setting up ${project.relativePath}: ${errorMessage}`,
      );
      clack.log.error(
        `Failed to set up ${project.frameworkName} in ${
          project.relativePath
        }: ${chalk.red(errorMessage)}`,
      );
      results.push({ project, success: false, error: errorMessage });
    }
  }

  printMonorepoSummary(results);

  const allSucceeded = results.every((r) => r.success);
  await analytics.shutdown(allSucceeded ? 'success' : 'error');
}

/** Run post-flight once: env var upload and MCP client installation. */
async function runPostFlight(
  results: ProjectResult[],
  sharedSetup: SharedSetupData,
  options: WizardOptions,
): Promise<void> {
  const successfulResults = results.filter((r) => r.success);
  if (successfulResults.length === 0) return;

  // Collect and upload env vars once for all successful projects
  const allEnvVars: Record<string, string> = {};
  for (const result of successfulResults) {
    const config = FRAMEWORK_REGISTRY[result.project.integration];
    const envVars = config.environment.getEnvVars(
      sharedSetup.projectApiKey,
      sharedSetup.host,
    );
    if (config.environment.uploadToHosting) {
      Object.assign(allEnvVars, envVars);
    }
  }

  if (Object.keys(allEnvVars).length > 0) {
    // Use the first project that requires hosting upload for the integration tag
    const uploadProject = successfulResults.find(
      (r) =>
        FRAMEWORK_REGISTRY[r.project.integration].environment.uploadToHosting,
    );
    if (uploadProject) {
      await uploadEnvironmentVariablesStep(allEnvVars, {
        integration: uploadProject.project.integration,
        options,
      });
    }
  }

  // Add MCP server to clients once (integration is only used for analytics)
  await addMCPServerToClientsStep({
    cloudRegion: sharedSetup.cloudRegion,
    integration: successfulResults[0].project.integration,
    ci: options.ci,
  });
}

/**
 * Present detected projects for user selection via multiselect.
 */
async function selectMonorepoProjects(
  projects: DetectedProject[],
  options: WizardOptions,
): Promise<DetectedProject[]> {
  // In CI mode, select all unconfigured projects automatically
  if (options.ci) {
    return projects.filter((p) => !p.alreadyConfigured);
  }

  const selectedDirs: string[] = await abortIfCancelled(
    clack.multiselect({
      message:
        'Which projects do you want to set up with PostHog?\n  (press space to toggle, enter to confirm)',
      options: projects.map((p) => ({
        value: p.dir,
        label: `${p.relativePath} → ${p.frameworkName}`,
        hint: p.alreadyConfigured ? 'PostHog already installed' : undefined,
      })),
      initialValues: projects
        .filter((p) => !p.alreadyConfigured)
        .map((p) => p.dir),
      required: false,
    }),
  );

  return projects.filter((p) => selectedDirs.includes(p.dir));
}

/**
 * Print a summary of all monorepo project setup results.
 */
function printMonorepoSummary(results: ProjectResult[]): void {
  const succeeded = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  const summaryLines = results.map((r) => {
    const name = r.project.relativePath
      ? `${r.project.relativePath} (${r.project.frameworkName})`
      : r.project.frameworkName;
    if (r.success) {
      return `${chalk.green('✓')} ${name}`;
    }
    return `${chalk.red('✗')} ${name} — ${r.error}`;
  });

  const summaryTitle =
    failed.length === 0
      ? chalk.green('Monorepo setup complete!')
      : chalk.yellow(
          `Monorepo setup complete: ${succeeded.length} succeeded, ${failed.length} failed`,
        );

  clack.note(summaryLines.join('\n'), summaryTitle);

  if (failed.length > 0) {
    clack.log.info(
      `For failed projects, visit ${chalk.cyan(
        'https://posthog.com/docs',
      )} for manual setup instructions.`,
    );
  }

  clack.outro(
    chalk.dim(
      'Note: This wizard uses an LLM agent to analyze and modify your project. Please review the changes made.',
    ),
  );
}
