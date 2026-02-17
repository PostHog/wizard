import { abortIfCancelled } from './utils/clack-utils';

import type { CloudRegion, WizardOptions } from './utils/types';

import { Integration } from './lib/constants';
import { readEnvironment } from './utils/environment';
import clack from './utils/clack';
import fs from 'fs';
import path from 'path';
import { FRAMEWORK_REGISTRY } from './lib/registry';
import { analytics } from './utils/analytics';
import {
  runAgentWizard,
  runSharedSetup,
  DisplayedError,
} from './lib/agent-runner';
import { EventEmitter } from 'events';
import chalk from 'chalk';
import { logToFile } from './utils/debug';
import { detectWorkspaces } from './utils/workspace-detection';
import { tryGetPackageJson } from './utils/clack-utils';
import { hasPackageInstalled } from './utils/package-json';
import {
  readWizardMarker,
  writeWizardMarker,
  classifyRerunReason,
} from './utils/wizard-marker';

EventEmitter.defaultMaxListeners = 50;

type Args = {
  integration?: Integration;
  debug?: boolean;
  forceInstall?: boolean;
  installDir?: string;
  region?: CloudRegion;
  default?: boolean;
  signup?: boolean;
  localMcp?: boolean;
  ci?: boolean;
  apiKey?: string;
  menu?: boolean;
};

type DetectedProject = {
  dir: string;
  relativePath: string;
  integration: Integration;
  frameworkName: string;
  alreadyConfigured: boolean;
};

type ProjectResult = {
  project: DetectedProject;
  success: boolean;
  error?: string;
};

export async function runWizard(argv: Args) {
  const finalArgs = {
    ...argv,
    ...readEnvironment(),
  };

  let resolvedInstallDir: string;
  if (finalArgs.installDir) {
    if (path.isAbsolute(finalArgs.installDir)) {
      resolvedInstallDir = finalArgs.installDir;
    } else {
      resolvedInstallDir = path.join(process.cwd(), finalArgs.installDir);
    }
  } else {
    resolvedInstallDir = process.cwd();
  }

  const wizardOptions: WizardOptions = {
    debug: finalArgs.debug ?? false,
    forceInstall: finalArgs.forceInstall ?? false,
    installDir: resolvedInstallDir,
    cloudRegion: finalArgs.region ?? undefined,
    default: finalArgs.default ?? false,
    signup: finalArgs.signup ?? false,
    localMcp: finalArgs.localMcp ?? false,
    ci: finalArgs.ci ?? false,
    apiKey: finalArgs.apiKey,
    menu: finalArgs.menu ?? false,
  };

  clack.intro(`Welcome to the PostHog setup wizard ✨`);

  if (wizardOptions.ci) {
    clack.log.info(chalk.dim('Running in CI mode'));
  }

  // Read previous wizard run marker and tag analytics with rerun context
  const previousMarker = await readWizardMarker(resolvedInstallDir);
  const posthogInstalled = await hasPostHogInstalled(resolvedInstallDir);
  const rerunReason = classifyRerunReason(previousMarker, posthogInstalled);
  analytics.setTag('posthog_already_installed', posthogInstalled);
  analytics.setTag('rerun_reason', rerunReason);
  if (previousMarker) {
    analytics.setTag('previous_run_status', previousMarker.status);
  }

  // If user specified --integration or --menu, skip monorepo detection
  if (!finalArgs.integration && !wizardOptions.menu) {
    // Check for monorepo before single-framework detection
    const monorepoProjects = await detectWorkspaceProjects(wizardOptions);

    if (monorepoProjects && monorepoProjects.length >= 2) {
      await runMonorepoFlow(monorepoProjects, wizardOptions);
      return;
    }
  }

  // Single-project flow (existing behavior, unchanged)
  const integration =
    finalArgs.integration ?? (await getIntegrationForSetup(wizardOptions));

  analytics.setTag('integration', integration);

  const config = FRAMEWORK_REGISTRY[integration];

  try {
    await runAgentWizard(config, wizardOptions);
    await writeWizardMarker(resolvedInstallDir, {
      status: 'success',
      integration,
    });
  } catch (error) {
    await writeWizardMarker(resolvedInstallDir, {
      status: 'error',
      integration,
    });

    analytics.captureException(error as Error, {
      integration,
      arguments: JSON.stringify(finalArgs),
    });

    await analytics.shutdown('error');

    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack =
      error instanceof Error && error.stack ? error.stack : undefined;

    // Log to file for debugging
    logToFile(`[Wizard run.ts] ERROR MESSAGE: ${errorMessage} `);
    if (errorStack) {
      logToFile(`[Wizard run.ts] ERROR STACK: ${errorStack}`);
    }

    // DisplayedError means agent-runner already showed the error to the user
    if (!(error instanceof DisplayedError)) {
      clack.log.error(
        `Something went wrong: ${chalk.red(
          errorMessage,
        )}\n\nYou can read the documentation at ${chalk.cyan(
          config.metadata.docsUrl,
        )} to set up PostHog manually.`,
      );

      if (wizardOptions.debug && errorStack) {
        clack.log.info(chalk.dim(errorStack));
      }
    }

    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Monorepo detection and flow
// ---------------------------------------------------------------------------

/**
 * Detect workspace members and run framework detection on each.
 * Returns detected projects, or null if this isn't a monorepo.
 */
async function detectWorkspaceProjects(
  options: WizardOptions,
): Promise<DetectedProject[] | null> {
  const workspace = await detectWorkspaces(options.installDir);
  if (!workspace) {
    return null;
  }

  logToFile(
    `[Monorepo] Detected ${workspace.type} workspace with ${workspace.memberDirs.length} members`,
  );

  const projects: DetectedProject[] = [];

  for (const memberDir of workspace.memberDirs) {
    const integration = await detectIntegration({ installDir: memberDir });
    if (integration) {
      const config = FRAMEWORK_REGISTRY[integration];
      const alreadyConfigured = await hasPostHogInstalled(memberDir);
      const relativePath = path.relative(options.installDir, memberDir);

      projects.push({
        dir: memberDir,
        relativePath,
        integration,
        frameworkName: config.metadata.name,
        alreadyConfigured,
      });
    }
  }

  return projects;
}

/**
 * Check if a PostHog SDK package is installed in a project directory.
 */
async function hasPostHogInstalled(dir: string): Promise<boolean> {
  // Check JS/TS projects via package.json
  const packageJson = await tryGetPackageJson({ installDir: dir });
  if (packageJson) {
    const posthogPackages = [
      'posthog-js',
      'posthog-node',
      'posthog-react-native',
    ];
    for (const pkg of posthogPackages) {
      if (hasPackageInstalled(pkg, packageJson)) {
        return true;
      }
    }
  }

  // Check Python projects via requirements*.txt and pyproject.toml
  if (await fileContainsPosthog(path.join(dir, 'requirements.txt')) ||
      await fileContainsPosthog(path.join(dir, 'requirements-dev.txt')) ||
      await fileContainsPosthog(path.join(dir, 'pyproject.toml'))) {
    return true;
  }

  // Check PHP/Laravel projects via composer.json
  if (await fileContainsPosthog(path.join(dir, 'composer.json'))) {
    return true;
  }

  return false;
}

async function fileContainsPosthog(filePath: string): Promise<boolean> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return content.includes('posthog');
  } catch {
    return false;
  }
}

/**
 * Run the monorepo flow: let user pick projects, then set up each sequentially.
 */
async function runMonorepoFlow(
  projects: DetectedProject[],
  options: WizardOptions,
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

  // Run wizard for each selected project
  const results: ProjectResult[] = [];

  for (let i = 0; i < selected.length; i++) {
    const project = selected[i];
    const projectNumber = i + 1;
    const totalProjects = selected.length;

    clack.log.step(
      `\n${chalk.cyan(`[${projectNumber}/${totalProjects}]`)} Setting up PostHog for ${chalk.bold(project.frameworkName)} in ${chalk.cyan(project.relativePath)}`,
    );

    const projectOptions: WizardOptions = {
      ...options,
      installDir: project.dir,
      cloudRegion: sharedSetup.cloudRegion,
    };

    const config = FRAMEWORK_REGISTRY[project.integration];

    analytics.setTag('integration', project.integration);

    try {
      await runAgentWizard(config, projectOptions, sharedSetup);
      await writeWizardMarker(project.dir, {
        status: 'success',
        integration: project.integration,
      });
      results.push({ project, success: true });
    } catch (error) {
      await writeWizardMarker(project.dir, {
        status: 'error',
        integration: project.integration,
      });
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logToFile(
        `[Monorepo] Error setting up ${project.relativePath}: ${errorMessage}`,
      );
      clack.log.error(
        `Failed to set up ${project.frameworkName} in ${project.relativePath}: ${chalk.red(errorMessage)}`,
      );
      results.push({ project, success: false, error: errorMessage });
      // Continue to next project instead of aborting
    }
  }

  // Show combined summary
  printMonorepoSummary(results);

  const allSucceeded = results.every((r) => r.success);
  await analytics.shutdown(allSucceeded ? 'success' : 'error');
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
      message: `Which projects do you want to set up with PostHog? ${chalk.dim('(Toggle: Space, Confirm: Enter, Toggle All: A)')}`,
      options: projects.map((p) => ({
        value: p.dir,
        label: `${p.relativePath} → ${p.frameworkName}${p.alreadyConfigured ? chalk.dim(' (PostHog already configured)') : ''}`,
        hint: p.alreadyConfigured ? 'already configured' : undefined,
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
    if (r.success) {
      return `${chalk.green('✓')} ${r.project.relativePath} (${r.project.frameworkName})`;
    }
    return `${chalk.red('✗')} ${r.project.relativePath} (${r.project.frameworkName}) — ${r.error}`;
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
      `For failed projects, visit ${chalk.cyan('https://posthog.com/docs')} for manual setup instructions.`,
    );
  }

  clack.outro(
    chalk.dim(
      'Note: This wizard uses an LLM agent to analyze and modify your project. Please review the changes made.',
    ),
  );
}

// ---------------------------------------------------------------------------
// Single-project detection (existing logic, unchanged)
// ---------------------------------------------------------------------------

async function detectIntegration(
  options: Pick<WizardOptions, 'installDir'>,
): Promise<Integration | undefined> {
  for (const integration of Object.values(Integration)) {
    const config = FRAMEWORK_REGISTRY[integration];
    const detected = await config.detection.detect(options);
    if (detected) {
      return integration;
    }
  }
}

async function getIntegrationForSetup(
  options: Pick<WizardOptions, 'installDir' | 'menu'>,
) {
  if (!options.menu) {
    const detectedIntegration = await detectIntegration(options);

    if (detectedIntegration) {
      clack.log.success(
        `Detected integration: ${FRAMEWORK_REGISTRY[detectedIntegration].metadata.name}`,
      );
      return detectedIntegration;
    }
  }

  const integration: Integration = await abortIfCancelled(
    clack.select({
      message: 'What do you want to set up?',
      options: Object.values(Integration).map((value) => ({
        value,
        label: FRAMEWORK_REGISTRY[value].metadata.name,
      })),
    }),
  );

  return integration;
}
