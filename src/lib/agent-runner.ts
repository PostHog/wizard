import {
  DEFAULT_PACKAGE_INSTALLATION,
  SPINNER_MESSAGE,
  type FrameworkConfig,
} from './framework-config';
import { type WizardSession, OutroKind } from './wizard-session';
import {
  tryGetPackageJson,
  isUsingTypeScript,
  getOrAskForProjectData,
} from '../utils/setup-utils';
import type { PackageDotJson } from '../utils/package-json';
import type { WizardOptions } from '../utils/types';
import { analytics } from '../utils/analytics';
import { getUI } from '../ui';
import {
  initializeAgent,
  runAgent,
  AgentSignals,
  AgentErrorType,
  buildWizardMetadata,
  checkClaudeSettingsOverrides,
  backupAndFixClaudeSettings,
  restoreClaudeSettings,
} from './agent-interface';
import { getCloudUrlFromRegion } from '../utils/urls';

import * as semver from 'semver';
import {
  evaluateWizardReadiness,
  WizardReadiness,
} from './health-checks/readiness';
import { enableDebugLogs, initLogFile, logToFile } from '../utils/debug';
import { createBenchmarkPipeline } from './middleware/benchmark';
import { wizardAbort, WizardError } from '../utils/wizard-abort';

/**
 * Build a WizardOptions bag from a WizardSession (for code that still expects WizardOptions).
 */
function sessionToOptions(session: WizardSession): WizardOptions {
  return {
    installDir: session.installDir,
    debug: session.debug,
    forceInstall: session.forceInstall,
    default: false,
    signup: session.signup,
    localMcp: session.localMcp,
    ci: session.ci,
    menu: session.menu,
    benchmark: session.benchmark,
    projectId: session.projectId,
    apiKey: session.apiKey,
  };
}

/**
 * Universal agent-powered wizard runner.
 * Handles the complete flow for any framework using PostHog MCP integration.
 *
 * All user decisions come from the session — no UI prompts.
 */
export async function runAgentWizard(
  config: FrameworkConfig,
  session: WizardSession,
): Promise<void> {
  initLogFile();
  logToFile(`[agent-runner] START integration=${config.metadata.integration}`);

  if (session.debug) {
    enableDebugLogs();
  }

  // Version check
  if (config.detection.minimumVersion && config.detection.getInstalledVersion) {
    logToFile('[agent-runner] checking version');
    const version = await config.detection.getInstalledVersion(
      sessionToOptions(session),
    );
    if (version) {
      logToFile(
        `[agent-runner] version=${version} minimum=${config.detection.minimumVersion}`,
      );
      const coerced = semver.coerce(version);
      if (coerced && semver.lt(coerced, config.detection.minimumVersion)) {
        const docsUrl =
          config.metadata.unsupportedVersionDocsUrl ?? config.metadata.docsUrl;
        await wizardAbort({
          message:
            `Sorry: the wizard can't help you with ${config.metadata.name} ${version}. ` +
            `Upgrade to ${config.metadata.name} ${config.detection.minimumVersion} or later, ` +
            `or check out the manual setup guide.\n\n` +
            `Setup ${config.metadata.name} manually: ${docsUrl}`,
        });
      }
    }
  }

  // Check all external service health (skip if TUI already ran it in bin.ts)
  if (!session.readinessResult) {
    logToFile('[agent-runner] evaluating wizard readiness');
    const readiness = await evaluateWizardReadiness();
    logToFile(`[agent-runner] readiness=${readiness.decision}`);
    if (readiness.decision === WizardReadiness.No) {
      await getUI().showBlockingOutage(readiness);
    } else if (readiness.decision === WizardReadiness.YesWithWarnings) {
      getUI().setReadinessWarnings(readiness);
    }
  }

  // Check for blocking env overrides in .claude/settings.json before login.
  const blockingOverrideKeys = checkClaudeSettingsOverrides(session.installDir);
  logToFile(
    `[agent-runner] settings overrides: ${
      blockingOverrideKeys.length > 0 ? blockingOverrideKeys.join(', ') : 'none'
    }`,
  );
  if (blockingOverrideKeys.length > 0) {
    await getUI().showSettingsOverride(blockingOverrideKeys, () =>
      backupAndFixClaudeSettings(session.installDir),
    );
    logToFile('[agent-runner] settings override resolved');
  }

  const typeScriptDetected = isUsingTypeScript({
    installDir: session.installDir,
  });
  session.typescript = typeScriptDetected;

  // Framework detection and version
  const usesPackageJson = config.detection.usesPackageJson !== false;
  let packageJson: PackageDotJson | null = null;
  let frameworkVersion: string | undefined;

  if (usesPackageJson) {
    packageJson = await tryGetPackageJson({ installDir: session.installDir });
    if (packageJson) {
      const { hasPackageInstalled } = await import('../utils/package-json.js');
      if (!hasPackageInstalled(config.detection.packageName, packageJson)) {
        getUI().log.warn(
          `${config.detection.packageDisplayName} does not seem to be installed. Continuing anyway — the agent will handle it.`,
        );
      }
      frameworkVersion = config.detection.getVersion(packageJson);
    } else {
      getUI().log.warn(
        'Could not find package.json. Continuing anyway — the agent will handle it.',
      );
    }
  } else {
    frameworkVersion = config.detection.getVersion(null);
  }

  // Set analytics tags for framework version
  if (frameworkVersion && config.detection.getVersionBucket) {
    const versionBucket = config.detection.getVersionBucket(frameworkVersion);
    analytics.setTag(`${config.metadata.integration}-version`, versionBucket);
  }

  analytics.wizardCapture('agent started', {
    integration: config.metadata.integration,
  });

  // Get PostHog credentials (region auto-detected from token)
  logToFile('[agent-runner] starting OAuth');
  const { projectApiKey, host, accessToken, projectId, cloudRegion } =
    await getOrAskForProjectData({
      signup: session.signup,
      ci: session.ci,
      apiKey: session.apiKey,
      projectId: session.projectId,
    });

  session.credentials = { accessToken, projectApiKey, host, projectId };

  // Notify TUI that credentials are available (resolves past AuthScreen)
  getUI().setCredentials(session.credentials);

  // Framework context was already gathered by SetupScreen + detection
  const frameworkContext = session.frameworkContext;

  // Set analytics tags from framework context
  const contextTags = config.analytics.getTags(frameworkContext);
  Object.entries(contextTags).forEach(([key, value]) => {
    analytics.setTag(key, value);
  });

  const integrationPrompt = buildIntegrationPrompt(
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

  // Initialize and run agent
  const spinner = getUI().spinner();

  // Evaluate all feature flags at the start of the run so they can be sent to the LLM gateway
  const wizardFlags = await analytics.getAllFlagsForWizard();
  const wizardMetadata = buildWizardMetadata(wizardFlags);

  // Determine MCP URL: CLI flag > env var > production default
  const mcpUrl = session.localMcp
    ? 'http://localhost:8787/mcp'
    : process.env.MCP_URL || 'https://mcp.posthog.com/mcp';

  const restoreSettings = () => restoreClaudeSettings(session.installDir);
  getUI().onEnterScreen('outro', restoreSettings);
  getUI().startRun();

  const agent = await initializeAgent(
    {
      workingDirectory: session.installDir,
      posthogMcpUrl: mcpUrl,
      posthogApiKey: accessToken,
      posthogApiHost: host,
      additionalMcpServers: config.metadata.additionalMcpServers,
      detectPackageManager: config.detection.detectPackageManager,
      wizardFlags,
      wizardMetadata,
    },
    sessionToOptions(session),
  );

  const middleware = session.benchmark
    ? createBenchmarkPipeline(spinner, sessionToOptions(session))
    : undefined;

  const agentResult = await runAgent(
    agent,
    integrationPrompt,
    sessionToOptions(session),
    spinner,
    {
      estimatedDurationMinutes: config.ui.estimatedDurationMinutes,
      spinnerMessage: SPINNER_MESSAGE,
      successMessage: config.ui.successMessage,
      errorMessage: 'Integration failed',
      additionalFeatureQueue: session.additionalFeatureQueue,
    },
    middleware,
  );

  // Handle error cases detected in agent output
  if (agentResult.error === AgentErrorType.MCP_MISSING) {
    await wizardAbort({
      message: `Could not access the PostHog MCP server\n\nThe wizard was unable to connect to the PostHog MCP server.\nThis could be due to a network issue or a configuration problem.\n\nPlease try again, or set up ${config.metadata.name} manually by following our documentation:\n${config.metadata.docsUrl}`,
      error: new WizardError('Agent could not access PostHog MCP server', {
        integration: config.metadata.integration,
        error_type: AgentErrorType.MCP_MISSING,
        signal: AgentSignals.ERROR_MCP_MISSING,
      }),
    });
  }

  if (agentResult.error === AgentErrorType.RESOURCE_MISSING) {
    await wizardAbort({
      message: `Could not access the setup resource\n\nThe wizard could not access the setup resource. This may indicate a version mismatch or a temporary service issue.\n\nPlease try again, or set up ${config.metadata.name} manually by following our documentation:\n${config.metadata.docsUrl}`,
      error: new WizardError('Agent could not access setup resource', {
        integration: config.metadata.integration,
        error_type: AgentErrorType.RESOURCE_MISSING,
        signal: AgentSignals.ERROR_RESOURCE_MISSING,
      }),
    });
  }

  if (
    agentResult.error === AgentErrorType.RATE_LIMIT ||
    agentResult.error === AgentErrorType.API_ERROR
  ) {
    analytics.wizardCapture('agent api error', {
      integration: config.metadata.integration,
      error_type: agentResult.error,
      error_message: agentResult.message,
    });

    await wizardAbort({
      message: `API Error\n\n${
        agentResult.message || 'Unknown error'
      }\n\nPlease report this error to: wizard@posthog.com`,
      error: new WizardError(`API error: ${agentResult.message}`, {
        integration: config.metadata.integration,
        error_type: agentResult.error,
      }),
    });
  }

  // Build environment variables from OAuth credentials
  const envVars = config.environment.getEnvVars(projectApiKey, host);

  // Upload environment variables to hosting providers (auto-accept)
  let uploadedEnvVars: string[] = [];
  if (config.environment.uploadToHosting) {
    const { uploadEnvironmentVariablesStep } = await import(
      '../steps/index.js'
    );
    uploadedEnvVars = await uploadEnvironmentVariablesStep(envVars, {
      integration: config.metadata.integration,
      session,
    });
  }

  // MCP installation is handled by McpScreen — no prompt here

  // Build outro data and store it for OutroScreen
  const continueUrl = session.signup
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

  session.outroData = {
    kind: OutroKind.Success,
    changes,
    docsUrl: config.metadata.docsUrl,
    continueUrl,
  };

  getUI().outro(`Successfully installed PostHog!`);

  await analytics.shutdown('success');
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
- PostHog public token: ${context.projectApiKey}
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

STEP 5: Follow the skill's workflow files in sequence. Look for numbered workflow files in the references (e.g., files with patterns like "1.0-", "1.1-", "1.2-"). Start with the first one and proceed through each step until completion. Each workflow file will tell you what to do and which file comes next. Never directly write PostHog tokens directly to code files; always use environment variables.

STEP 6: Set up environment variables for PostHog using the wizard-tools MCP server (this runs locally — secret values never leave the machine):
   - Use check_env_keys to see which keys already exist in the project's .env file (e.g. .env.local or .env).
   - Use set_env_values to create or update the PostHog public token and host, using the appropriate environment variable naming convention for ${
     config.metadata.name
   }, which you'll find in example code. The tool will also ensure .gitignore coverage. Don't assume the presence of keys means the value is up to date. Write the correct value each time.
   - Reference these environment variables in the code files you create instead of hardcoding the public token and host.

Important: Use the detect_package_manager tool (from the wizard-tools MCP server) to determine which package manager the project uses. Do not manually search for lockfiles or config files. Always install packages as a background task. Don't await completion; proceed with other work immediately after starting the installation. You must read a file immediately before attempting to write it, even if you have previously read it; failure to do so will cause a tool failure.


`;
}
