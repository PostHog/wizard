import {
  DEFAULT_PACKAGE_INSTALLATION,
  getWelcomeMessage,
  SPINNER_MESSAGE,
  type FrameworkConfig,
} from './framework-config';
import type { WizardOptions } from '../utils/types';
import {
  abort,
  askForAIConsent,
  confirmContinueIfNoOrDirtyGitRepo,
  ensurePackageIsInstalled,
  getOrAskForProjectData,
  getPackageDotJson,
  isUsingTypeScript,
  printWelcome,
  askForCloudRegion,
} from '../utils/clack-utils';
import type { PackageDotJson } from '../utils/package-json';
import { analytics } from '../utils/analytics';
import { WIZARD_INTERACTION_EVENT_NAME } from './constants';
import clack from '../utils/clack';
import {
  initializeAgent,
  runAgent,
  AgentSignals,
  AgentErrorType,
} from './agent-interface';
import { getCloudUrlFromRegion } from '../utils/urls';
import chalk from 'chalk';
import * as semver from 'semver';
import {
  addMCPServerToClientsStep,
  uploadEnvironmentVariablesStep,
} from '../steps';
import { checkAnthropicStatusWithPrompt } from '../utils/anthropic-status';
import { enableDebugLogs, logToFile } from '../utils/debug';
import { createBenchmarkPipeline } from './middleware/benchmark';
import { DisplayedError } from './errors';
import type { CloudRegion } from '../utils/types';

// Re-export for consumers that import from agent-runner
export { DisplayedError } from './errors';

/** Setup data gathered once and reused across monorepo project runs. */
export type SharedSetupData = {
  cloudRegion: CloudRegion;
  projectApiKey: string;
  host: string;
  accessToken: string;
  projectId: number;
};

/** Options controlling which phases runAgentWizard executes. */
export type AgentWizardMode = {
  /** Pre-gathered setup data; skips AI consent, region, git, OAuth. */
  sharedSetup?: SharedSetupData;
  /** Skip post-agent steps (env upload, MCP client install, outro). */
  skipPostAgent?: boolean;
  /** Append a monorepo scope-fencing instruction to the agent prompt. */
  concurrentFence?: boolean;
  /** Extra context lines appended to the agent prompt (e.g. workspace type). */
  additionalContext?: string[];
  /** Called when the agent emits a [STATUS] progress message. */
  onStatus?: (message: string) => void;
};

/** Run shared setup (AI consent, status check, region, git, OAuth). */
export async function runSharedSetup(
  options: WizardOptions,
  docsUrl?: string,
): Promise<SharedSetupData> {
  if (options.debug) {
    enableDebugLogs();
  }

  const fallbackUrl = docsUrl ?? 'https://posthog.com/docs';

  clack.log.info(
    `We're about to read your project using our LLM gateway.\n\n.env* file contents will not leave your machine.\n\nOther files will be read and edited to provide a fully-custom PostHog integration.`,
  );

  const aiConsent = await askForAIConsent(options);
  if (!aiConsent) {
    await abort(
      `This wizard uses an LLM agent to intelligently modify your project. Please view the docs to set up PostHog manually instead: ${fallbackUrl}`,
      0,
    );
  }

  const statusOk = await checkAnthropicStatusWithPrompt({ ci: options.ci });
  if (!statusOk) {
    await abort(
      `Please try again later, or set up PostHog manually: ${fallbackUrl}`,
      0,
    );
  }

  const cloudRegion = options.cloudRegion ?? (await askForCloudRegion());

  await confirmContinueIfNoOrDirtyGitRepo(options);

  const { projectApiKey, host, accessToken, projectId } =
    await getOrAskForProjectData({
      ...options,
      cloudRegion,
    });

  return { cloudRegion, projectApiKey, host, accessToken, projectId };
}

/** Run pre-flight for a project (version check, detection, gatherContext). Returns null to skip. */
export async function runPreflight(
  config: FrameworkConfig,
  options: WizardOptions,
): Promise<PreflightData | null> {
  // Version check
  if (config.detection.minimumVersion && config.detection.getInstalledVersion) {
    const version = await config.detection.getInstalledVersion(options);
    if (version) {
      const coerced = semver.coerce(version);
      if (coerced && semver.lt(coerced, config.detection.minimumVersion)) {
        const docsUrl =
          config.metadata.unsupportedVersionDocsUrl ?? config.metadata.docsUrl;
        clack.log.warn(
          `Sorry: the wizard can't help you with ${config.metadata.name} ${version}. Upgrade to ${config.metadata.name} ${config.detection.minimumVersion} or later, or check out the manual setup guide.`,
        );
        clack.log.info(
          `Setup ${config.metadata.name} manually: ${chalk.cyan(docsUrl)}`,
        );
        return null;
      }
    }
  }

  const typeScriptDetected = isUsingTypeScript(options);

  // Framework detection and version
  const usesPackageJson = config.detection.usesPackageJson !== false;
  let packageJson: PackageDotJson | null = null;
  let frameworkVersion: string | undefined;

  if (usesPackageJson) {
    packageJson = await getPackageDotJson(options);
    await ensurePackageIsInstalled(
      packageJson,
      config.detection.packageName,
      config.detection.packageDisplayName,
    );
    frameworkVersion = config.detection.getVersion(packageJson);
  } else {
    frameworkVersion = config.detection.getVersion(null);
  }

  // Set analytics tags for framework version
  if (frameworkVersion && config.detection.getVersionBucket) {
    const versionBucket = config.detection.getVersionBucket(frameworkVersion);
    analytics.setTag(`${config.metadata.integration}-version`, versionBucket);
  }

  // Gather framework-specific context (e.g., Next.js router, React Native platform)
  const frameworkContext = config.metadata.gatherContext
    ? await config.metadata.gatherContext(options)
    : {};

  // Set analytics tags from framework context
  const contextTags = config.analytics.getTags(frameworkContext);
  Object.entries(contextTags).forEach(([key, value]) => {
    analytics.setTag(key, value);
  });

  return { frameworkContext, frameworkVersion, typeScriptDetected };
}

/** Data gathered during the per-project pre-flight phase. */
export type PreflightData = {
  frameworkContext: Record<string, unknown>;
  frameworkVersion: string | undefined;
  typeScriptDetected: boolean;
};

/** Universal agent-powered wizard runner. Behavior controlled by `mode`. */
export async function runAgentWizard(
  config: FrameworkConfig,
  options: WizardOptions,
  mode?: AgentWizardMode & { preflight?: PreflightData },
): Promise<void> {
  if (options.debug) {
    enableDebugLogs();
  }

  const sharedSetup = mode?.sharedSetup;
  const skipPostAgent = mode?.skipPostAgent ?? false;

  // If no pre-gathered preflight, show welcome inline
  let preflight = mode?.preflight;
  if (!preflight) {
    printWelcome({ wizardName: getWelcomeMessage(config.metadata.name) });

    if (config.metadata.beta) {
      clack.log.info(
        `${chalk.yellow('[BETA]')} The ${
          config.metadata.name
        } wizard is in beta. Questions or feedback? Email ${chalk.cyan(
          'wizard@posthog.com',
        )}`,
      );
    }

    if (config.metadata.preRunNotice) {
      clack.log.warn(config.metadata.preRunNotice);
    }
  }

  const { cloudRegion, projectApiKey, host, accessToken, projectId } =
    sharedSetup ?? (await runSharedSetup(options, config.metadata.docsUrl));

  // Use pre-gathered preflight data or run it now
  if (!preflight) {
    const preflightResult = await runPreflight(config, options);
    if (!preflightResult) {
      // Version check or package detection failed
      clack.outro('PostHog wizard will see you next time!');
      return;
    }
    preflight = preflightResult;
  }

  const { frameworkContext, frameworkVersion, typeScriptDetected } = preflight;

  analytics.capture(WIZARD_INTERACTION_EVENT_NAME, {
    action: 'started agent integration',
    integration: config.metadata.integration,
  });

  let integrationPrompt = buildIntegrationPrompt(
    config,
    {
      frameworkVersion: frameworkVersion || 'latest',
      typescript: typeScriptDetected,
      projectApiKey,
      host,
      projectId,
    },
    frameworkContext,
  );

  // Prompt fencing for concurrent monorepo mode
  if (mode?.concurrentFence) {
    integrationPrompt += `IMPORTANT: This project is being set up as part of a monorepo with other projects running concurrently. You MUST only modify files within the project directory at ${options.installDir}. Do not navigate to, read from, or edit files in sibling packages or parent directories. Do not modify shared configuration files outside your project scope.\n\nYour working directory is already set to ${options.installDir}. When using set_env_values or check_env_keys, use paths relative to THIS directory (e.g. ".env" or ".env.local"), NOT paths that include the project's subdirectory name.\n\n`;
  }

  // Append any extra context from monorepo orchestration
  if (mode?.additionalContext?.length) {
    integrationPrompt += mode.additionalContext
      .map((line) => `${line}\n`)
      .join('');
    integrationPrompt += '\n';
  }

  // Initialize and run agent
  const spinner = clack.spinner();

  // Determine MCP URL: CLI flag > env var > production default
  // Use EU subdomain for EU users to work around Claude Code's OAuth bug
  // See: https://github.com/anthropics/claude-code/issues/2267
  const mcpUrl = options.localMcp
    ? 'http://localhost:8787/mcp'
    : process.env.MCP_URL ||
      (cloudRegion === 'eu'
        ? 'https://mcp-eu.posthog.com/mcp'
        : 'https://mcp.posthog.com/mcp');

  const agent = await initializeAgent(
    {
      workingDirectory: options.installDir,
      posthogMcpUrl: mcpUrl,
      posthogApiKey: accessToken,
      posthogApiHost: host,
      additionalMcpServers: config.metadata.additionalMcpServers,
      detectPackageManager: config.detection.detectPackageManager,
    },
    options,
  );

  const middleware = options.benchmark
    ? createBenchmarkPipeline(spinner, options)
    : undefined;

  const agentResult = await runAgent(
    agent,
    integrationPrompt,
    options,
    spinner,
    {
      estimatedDurationMinutes: config.ui.estimatedDurationMinutes,
      spinnerMessage: SPINNER_MESSAGE,
      successMessage: config.ui.successMessage,
      errorMessage: 'Integration failed',
    },
    middleware,
    mode?.onStatus,
  );

  // Handle error cases detected in agent output
  handleAgentErrors(agentResult, config);

  logToFile(
    `[runAgentWizard] Agent completed successfully for ${config.metadata.name}`,
  );

  // Skip post-agent steps when the caller handles them (monorepo concurrent mode)
  if (skipPostAgent) {
    return;
  }

  // Build environment variables from OAuth credentials
  const envVars = config.environment.getEnvVars(projectApiKey, host);

  // Upload environment variables to hosting providers (if configured)
  let uploadedEnvVars: string[] = [];
  if (config.environment.uploadToHosting) {
    uploadedEnvVars = await uploadEnvironmentVariablesStep(envVars, {
      integration: config.metadata.integration,
      options,
    });
  }

  // Add MCP server to clients
  await addMCPServerToClientsStep({
    cloudRegion,
    integration: config.metadata.integration,
    ci: options.ci,
  });

  // Build outro message
  const continueUrl = options.signup
    ? `${getCloudUrlFromRegion(cloudRegion)}/products?source=wizard`
    : undefined;

  const changes = [
    ...config.ui.getOutroChanges(frameworkContext),
    Object.keys(envVars).length > 0
      ? `Added environment variables to .env file`
      : '',
    uploadedEnvVars.length > 0
      ? `Uploaded environment variables to your hosting provider`
      : '',
  ].filter(Boolean);

  const nextSteps = [
    ...config.ui.getOutroNextSteps(frameworkContext),
    uploadedEnvVars.length === 0 && config.environment.uploadToHosting
      ? `Upload your Project API key to your hosting provider`
      : '',
  ].filter(Boolean);

  const outroMessage = `
${chalk.green('Successfully installed PostHog!')}

${chalk.cyan('What the agent did:')}
${changes.map((change) => `• ${change}`).join('\n')}

${chalk.yellow('Next steps:')}
${nextSteps.map((step) => `• ${step}`).join('\n')}

Learn more: ${chalk.cyan(config.metadata.docsUrl)}
${continueUrl ? `\nContinue onboarding: ${chalk.cyan(continueUrl)}\n` : ``}
${chalk.dim(
  'Note: This wizard uses an LLM agent to analyze and modify your project. Please review the changes made.',
)}

${chalk.dim(`How did this work for you? Drop us a line: wizard@posthog.com`)}`;

  // In monorepo sequential mode, use log.success instead of outro
  if (sharedSetup) {
    clack.log.success(outroMessage);
  } else {
    clack.outro(outroMessage);
    await analytics.shutdown('success');
  }
}

/** Check agent result for known error types and throw DisplayedError. */
function handleAgentErrors(
  agentResult: { error?: string; message?: string },
  config: FrameworkConfig,
): void {
  if (agentResult.error === AgentErrorType.MCP_MISSING) {
    analytics.captureException(
      new Error('Agent could not access PostHog MCP server'),
      {
        integration: config.metadata.integration,
        error_type: AgentErrorType.MCP_MISSING,
        signal: AgentSignals.ERROR_MCP_MISSING,
      },
    );

    const errorMessage = `
${chalk.red('❌ Could not access the PostHog MCP server')}

The wizard was unable to connect to the PostHog MCP server.
This could be due to a network issue or a configuration problem.

Please try again, or set up ${
      config.metadata.name
    } manually by following our documentation:
${chalk.cyan(config.metadata.docsUrl)}`;

    clack.log.error(errorMessage);
    throw new DisplayedError(
      `Could not access the PostHog MCP server for ${config.metadata.name}`,
    );
  }

  if (agentResult.error === AgentErrorType.RESOURCE_MISSING) {
    analytics.captureException(
      new Error('Agent could not access setup resource'),
      {
        integration: config.metadata.integration,
        error_type: AgentErrorType.RESOURCE_MISSING,
        signal: AgentSignals.ERROR_RESOURCE_MISSING,
      },
    );

    const errorMessage = `
${chalk.red('❌ Could not access the setup resource')}

The wizard could not access the setup resource. This may indicate a version mismatch or a temporary service issue.

Please try again, or set up ${
      config.metadata.name
    } manually by following our documentation:
${chalk.cyan(config.metadata.docsUrl)}`;

    clack.log.error(errorMessage);
    throw new DisplayedError(
      `Could not access setup resource for ${config.metadata.name}`,
    );
  }

  if (
    agentResult.error === AgentErrorType.RATE_LIMIT ||
    agentResult.error === AgentErrorType.API_ERROR
  ) {
    analytics.capture(WIZARD_INTERACTION_EVENT_NAME, {
      action: 'api error',
      integration: config.metadata.integration,
      error_type: agentResult.error,
      error_message: agentResult.message,
    });

    analytics.captureException(new Error(`API error: ${agentResult.message}`), {
      integration: config.metadata.integration,
      error_type: agentResult.error,
    });

    const errorMessage = `
${chalk.red('❌ API Error')}

${chalk.yellow(agentResult.message || 'Unknown error')}

Please report this error to: ${chalk.cyan('wizard@posthog.com')}`;

    clack.log.error(errorMessage);
    throw new DisplayedError(
      `API error during ${config.metadata.name} setup: ${
        agentResult.message || 'Unknown error'
      }`,
    );
  }
}

/**
 * Build the integration prompt for the agent.
 */
function buildIntegrationPrompt(
  config: FrameworkConfig,
  context: {
    frameworkVersion: string;
    typescript: boolean;
    projectApiKey: string;
    host: string;
    projectId: number;
  },
  frameworkContext: Record<string, unknown>,
): string {
  const additionalLines = config.prompts.getAdditionalContextLines
    ? config.prompts.getAdditionalContextLines(frameworkContext)
    : [];

  const additionalContext =
    additionalLines.length > 0
      ? '\n' + additionalLines.map((line) => `- ${line}`).join('\n')
      : '';

  return `You have access to the PostHog MCP server which provides skills to integrate PostHog into this ${
    config.metadata.name
  } project.

Project context:
- PostHog Project ID: ${context.projectId}
- Framework: ${config.metadata.name} ${context.frameworkVersion}
- TypeScript: ${context.typescript ? 'Yes' : 'No'}
- PostHog API Key: ${context.projectApiKey}
- PostHog Host: ${context.host}
- Project type: ${config.prompts.projectTypeDetection}
- Package installation: ${
    config.prompts.packageInstallation ?? DEFAULT_PACKAGE_INSTALLATION
  }${additionalContext}

Instructions (follow these steps IN ORDER - do not skip or reorder):

STEP 1: List available skills from the PostHog MCP server using ListMcpResourcesTool. If this tool is not available or you cannot access the MCP server, you must emit: ${
    AgentSignals.ERROR_MCP_MISSING
  } Could not access the PostHog MCP server and halt.

   Review the skill descriptions and choose the one that best matches this project's framework and configuration.
   If no suitable skill is found, or you cannot access the MCP server, you emit: ${
     AgentSignals.ERROR_RESOURCE_MISSING
   } Could not find a suitable skill for this project.

STEP 2: Fetch the chosen skill resource (e.g., posthog://skills/{skill-id}).
   The resource returns a shell command to install the skill.

STEP 3: Run the installation command using Bash:
   - Execute the EXACT command returned by the resource (do not modify it)
   - This will download and extract the skill to .claude/skills/{skill-id}/

STEP 4: Load the installed skill's SKILL.md file to understand what references are available.

STEP 5: Follow the skill's workflow files in sequence. Look for numbered workflow files in the references (e.g., files with patterns like "1.0-", "1.1-", "1.2-"). Start with the first one and proceed through each step until completion. Each workflow file will tell you what to do and which file comes next.

STEP 6: Set up environment variables for PostHog using the wizard-tools MCP server (this runs locally — secret values never leave the machine):
   - Use check_env_keys to see which keys already exist in the project's .env file (e.g. .env.local or .env).
   - Use set_env_values to create or update the PostHog API key and host, using the appropriate naming convention for ${
     config.metadata.name
   }. The tool will also ensure .gitignore coverage. Don't assume the presence of keys means the value is up to date. Write the correct value each time.
   - Reference these environment variables in the code files you create instead of hardcoding the API key and host.

Important: Use the detect_package_manager tool (from the wizard-tools MCP server) to determine which package manager the project uses. Do not manually search for lockfiles or config files. Always install packages as a background task. Don't await completion; proceed with other work immediately after starting the installation. You must read a file immediately before attempting to write it, even if you have previously read it; failure to do so will cause a tool failure.

IMPORTANT — Prior run detection: BEFORE exploring the codebase, check if a file named "posthog-setup-report.md" exists in the project root (use Glob or Read). If it exists, read it — it contains a summary of what a previous wizard run already set up (installed packages, initialized files, events, dashboards, insights). Use this as your starting point: skip any work that's already done and only add what's missing. This saves significant exploration time and context.

IMPORTANT — Context window management: You have a limited context window. Be efficient:
  - Call dashboards-get-all and insights-get-all exactly ONCE each during the entire session. The insights response is very large (often 100K+ tokens) and will exhaust your context if called again. Save the names/IDs from each call and refer to your saved list for all subsequent checks.
  - BATCH EDITS: When you need to make multiple changes to the same file, plan ALL changes first, then make them in as few Edit calls as possible.
  - AVOID re-reading files you have already read recently unless you need to edit them.

`;
}
