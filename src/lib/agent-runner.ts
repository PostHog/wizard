import {
  DEFAULT_PACKAGE_INSTALLATION,
  getWelcomeMessage,
  SPINNER_MESSAGE,
  type FrameworkConfig,
} from './framework-config';
import type { WizardSession } from './wizard-session';
import {
  getPackageDotJson,
  isUsingTypeScript,
  getOrAskForProjectData,
} from '../utils/setup-utils';
import type { PackageDotJson } from '../utils/package-json';
import { analytics } from '../utils/analytics';
import { WIZARD_INTERACTION_EVENT_NAME } from './constants';
import { getUI } from '../ui';
import {
  initializeAgent,
  runAgent,
  AgentSignals,
  AgentErrorType,
} from './agent-interface';
import { getCloudUrlFromRegion } from '../utils/urls';
import chalk from 'chalk';
import * as semver from 'semver';
import { checkAnthropicStatus } from '../utils/anthropic-status';
import { enableDebugLogs } from '../utils/debug';

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
  if (session.debug) {
    enableDebugLogs();
  }

  const cloudRegion = session.cloudRegion!;

  // Version check
  if (config.detection.minimumVersion && config.detection.getInstalledVersion) {
    const version = await config.detection.getInstalledVersion({
      installDir: session.installDir,
      debug: session.debug,
      forceInstall: session.forceInstall,
      default: false,
      signup: session.signup,
      localMcp: session.localMcp,
      ci: session.ci,
      menu: session.menu,
    });
    if (version) {
      const coerced = semver.coerce(version);
      if (coerced && semver.lt(coerced, config.detection.minimumVersion)) {
        const docsUrl =
          config.metadata.unsupportedVersionDocsUrl ?? config.metadata.docsUrl;
        getUI().log.warn(
          `Sorry: the wizard can't help you with ${config.metadata.name} ${version}. Upgrade to ${config.metadata.name} ${config.detection.minimumVersion} or later, or check out the manual setup guide.`,
        );
        getUI().log.info(
          `Setup ${config.metadata.name} manually: ${chalk.cyan(docsUrl)}`,
        );
        getUI().outro('PostHog wizard will see you next time!');
        return;
      }
    }
  }

  // Setup phase — informational only, no prompts
  getUI().setSetupData({
    wizardLabel: getWelcomeMessage(config.metadata.name),
  });

  if (config.metadata.beta) {
    getUI().setSetupData({
      betaNotice: `[BETA] The ${config.metadata.name} wizard is in beta. Questions or feedback? Email wizard@posthog.com`,
    });
  }

  if (config.metadata.preRunNotice) {
    getUI().setSetupData({ preRunNotice: config.metadata.preRunNotice });
  }

  // Check Anthropic/Claude service status (pure — no prompt)
  const statusResult = await checkAnthropicStatus();
  if (statusResult.status === 'down' || statusResult.status === 'degraded') {
    session.serviceStatus = {
      description: statusResult.description,
      statusPageUrl: 'https://status.claude.com',
    };
    getUI().showServiceStatus(session.serviceStatus);
  }

  // Disclosure about what happens next
  getUI().setSetupData({
    disclosure: `We're about to read your project using our LLM gateway.\n\n.env* file contents will not leave your machine.\n\nOther files will be read and edited to provide a fully-custom PostHog integration.`,
  });

  const typeScriptDetected = isUsingTypeScript({
    installDir: session.installDir,
  });
  session.typescript = typeScriptDetected;

  // Framework detection and version
  const usesPackageJson = config.detection.usesPackageJson !== false;
  let packageJson: PackageDotJson | null = null;
  let frameworkVersion: string | undefined;

  if (usesPackageJson) {
    packageJson = await getPackageDotJson({ installDir: session.installDir });
    // Log warning if package not installed, but continue (agent handles it)
    const { hasPackageInstalled } = await import('../utils/package-json.js');
    if (!hasPackageInstalled(config.detection.packageName, packageJson)) {
      getUI().log.warn(
        `${config.detection.packageDisplayName} does not seem to be installed. Continuing anyway — the agent will handle it.`,
      );
    }
    frameworkVersion = config.detection.getVersion(packageJson);
  } else {
    frameworkVersion = config.detection.getVersion(null);
  }

  // Set analytics tags for framework version
  if (frameworkVersion && config.detection.getVersionBucket) {
    const versionBucket = config.detection.getVersionBucket(frameworkVersion);
    analytics.setTag(`${config.metadata.integration}-version`, versionBucket);
  }

  analytics.capture(WIZARD_INTERACTION_EVENT_NAME, {
    action: 'started agent integration',
    integration: config.metadata.integration,
  });

  // Get PostHog credentials
  const { projectApiKey, host, accessToken } = await getOrAskForProjectData({
    signup: session.signup,
    ci: session.ci,
    apiKey: session.apiKey,
    cloudRegion,
  });

  session.credentials = { accessToken, projectApiKey, host, projectId: 0 };

  // Framework context was already gathered by SetupScreen + detection
  const frameworkContext = session.frameworkContext;

  // Set analytics tags from framework context
  const contextTags = config.analytics.getTags(frameworkContext);
  Object.entries(contextTags).forEach(([key, value]) => {
    analytics.setTag(key, value);
  });

  // Build integration prompt
  const integrationPrompt = buildIntegrationPrompt(
    config,
    {
      frameworkVersion: frameworkVersion || 'latest',
      typescript: typeScriptDetected,
      projectApiKey,
      host,
    },
    frameworkContext,
  );

  // Initialize and run agent
  const spinner = getUI().spinner();

  // Determine MCP URL: CLI flag > env var > production default
  const mcpUrl = session.localMcp
    ? 'http://localhost:8787/mcp'
    : process.env.MCP_URL ||
      (cloudRegion === 'eu'
        ? 'https://mcp-eu.posthog.com/mcp'
        : 'https://mcp.posthog.com/mcp');

  // Transition to run screen
  getUI().startRun();

  const agent = await initializeAgent(
    {
      workingDirectory: session.installDir,
      posthogMcpUrl: mcpUrl,
      posthogApiKey: accessToken,
      posthogApiHost: host,
      additionalMcpServers: config.metadata.additionalMcpServers,
      detectPackageManager: config.detection.detectPackageManager,
    },
    {
      installDir: session.installDir,
      debug: session.debug,
      forceInstall: session.forceInstall,
      default: false,
      signup: session.signup,
      localMcp: session.localMcp,
      ci: session.ci,
      menu: session.menu,
    },
  );

  const agentResult = await runAgent(
    agent,
    integrationPrompt,
    {
      installDir: session.installDir,
      debug: session.debug,
      forceInstall: session.forceInstall,
      default: false,
      signup: session.signup,
      localMcp: session.localMcp,
      ci: session.ci,
      menu: session.menu,
    },
    spinner,
    {
      estimatedDurationMinutes: config.ui.estimatedDurationMinutes,
      spinnerMessage: SPINNER_MESSAGE,
      successMessage: config.ui.successMessage,
      errorMessage: 'Integration failed',
    },
  );

  // Handle error cases detected in agent output
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
${chalk.red('Could not access the PostHog MCP server')}

The wizard was unable to connect to the PostHog MCP server.
This could be due to a network issue or a configuration problem.

Please try again, or set up ${
      config.metadata.name
    } manually by following our documentation:
${chalk.cyan(config.metadata.docsUrl)}`;

    getUI().outro(errorMessage);
    await analytics.shutdown('error');
    process.exit(1);
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
${chalk.red('Could not access the setup resource')}

The wizard could not access the setup resource. This may indicate a version mismatch or a temporary service issue.

Please try again, or set up ${
      config.metadata.name
    } manually by following our documentation:
${chalk.cyan(config.metadata.docsUrl)}`;

    getUI().outro(errorMessage);
    await analytics.shutdown('error');
    process.exit(1);
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
${chalk.red('API Error')}

${chalk.yellow(agentResult.message || 'Unknown error')}

Please report this error to: ${chalk.cyan('wizard@posthog.com')}`;

    getUI().outro(errorMessage);
    await analytics.shutdown('error');
    process.exit(1);
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

  const nextSteps = [
    ...config.ui.getOutroNextSteps(frameworkContext),
    uploadedEnvVars.length === 0 && config.environment.uploadToHosting
      ? `Upload your Project API key to your hosting provider`
      : '',
  ].filter(Boolean);

  session.outroData = {
    kind: 'success',
    changes,
    nextSteps,
    docsUrl: config.metadata.docsUrl,
    continueUrl,
  };

  getUI().outro(`Successfully installed PostHog!`);

  await analytics.shutdown('success');
}

/**
 * Build the integration prompt for the agent.
 * Uses shared base prompt with optional framework-specific addendum.
 */
function buildIntegrationPrompt(
  config: FrameworkConfig,
  context: {
    frameworkVersion: string;
    typescript: boolean;
    projectApiKey: string;
    host: string;
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

STEP 5: Follow the skill's workflow files in sequence. Look for numbered workflow files in the references (e.g., files with patterns like "1.0-", "1.1-", "1.2-"). Start with the first one and proceed through each step until completion. Each workflow file will tell you what to do and which file comes next. Never directly write PostHog keys directly to code files; always use environment variables.

STEP 6: Set up environment variables for PostHog using the wizard-tools MCP server (this runs locally — secret values never leave the machine):
   - Use check_env_keys to see which keys already exist in the project's .env file (e.g. .env.local or .env).
   - Use set_env_values to create or update the PostHog API key and host, using the appropriate naming convention for ${
     config.metadata.name
   }. The tool will also ensure .gitignore coverage. Don't assume the presence of keys means the value is up to date. Write the correct value each time.
   - Reference these environment variables in the code files you create instead of hardcoding the API key and host.

Important: Use the detect_package_manager tool (from the wizard-tools MCP server) to determine which package manager the project uses. Do not manually search for lockfiles or config files. Always install packages as a background task. Don't await completion; proceed with other work immediately after starting the installation. You must read a file immediately before attempting to write it, even if you have previously read it; failure to do so will cause a tool failure.

`;
}
