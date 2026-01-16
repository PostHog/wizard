import {
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
import {
  addMCPServerToClientsStep,
  uploadEnvironmentVariablesStep,
} from '../steps';

/**
 * Universal agent-powered wizard runner.
 * Handles the complete flow for any framework using PostHog MCP integration.
 */
export async function runAgentWizard(
  config: FrameworkConfig,
  options: WizardOptions,
): Promise<void> {
  // Setup phase
  printWelcome({ wizardName: getWelcomeMessage(config.metadata.name) });

  clack.log.info(
    `🧙 The wizard has chosen you to try the next-generation agent integration for ${config.metadata.name}.\n\nStand by for the good stuff, and let the robot minders know how it goes:\n\nwizard@posthog.com`,
  );

  const aiConsent = await askForAIConsent(options);
  if (!aiConsent) {
    await abort(
      `This wizard uses an LLM agent to intelligently modify your project. Please view the docs to set up ${config.metadata.name} manually instead: ${config.metadata.docsUrl}`,
      0,
    );
  }

  const cloudRegion = options.cloudRegion ?? (await askForCloudRegion());
  const typeScriptDetected = isUsingTypeScript(options);

  await confirmContinueIfNoOrDirtyGitRepo(options);

  // Framework detection and version
  // Only check package.json for Node.js/JavaScript frameworks
  const usesPackageJson = config.detection.usesPackageJson !== false;
  let packageJson: any = null;
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
    // For non-Node frameworks (e.g., Django), version is handled differently
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
    ...options,
    cloudRegion,
  });

  // Gather framework-specific context (e.g., Next.js router, React Native platform)
  const frameworkContext = config.metadata.gatherContext
    ? await config.metadata.gatherContext(options)
    : {};

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
  const spinner = clack.spinner();

  // Determine MCP URL: CLI flag > env var > production default
  const mcpUrl = options.localMcp
    ? 'http://localhost:8787/mcp'
    : process.env.MCP_URL || 'https://mcp.posthog.com/mcp';

  const agent = initializeAgent(
    {
      workingDirectory: options.installDir,
      posthogMcpUrl: mcpUrl,
      posthogApiKey: accessToken,
      posthogApiHost: host,
    },
    options,
  );

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
${chalk.red('❌ Could not access the PostHog MCP server')}

The wizard was unable to connect to the PostHog MCP server.
This could be due to a network issue or a configuration problem.

Please try again, or set up ${
      config.metadata.name
    } manually by following our documentation:
${chalk.cyan(config.metadata.docsUrl)}`;

    clack.outro(errorMessage);
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
${chalk.red('❌ Could not access the setup resource')}

The wizard could not access the setup resource. This may indicate a version mismatch or a temporary service issue.

Please try again, or set up ${
      config.metadata.name
    } manually by following our documentation:
${chalk.cyan(config.metadata.docsUrl)}`;

    clack.outro(errorMessage);
    await analytics.shutdown('error');
    process.exit(1);
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

  clack.outro(outroMessage);

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
  frameworkContext: Record<string, any>,
): string {
  const additionalLines = config.prompts.getAdditionalContextLines
    ? config.prompts.getAdditionalContextLines(frameworkContext)
    : [];

  const additionalContext =
    additionalLines.length > 0
      ? '\n' + additionalLines.map((line) => `- ${line}`).join('\n')
      : '';

  return `You have access to the PostHog MCP server which provides an integration resource to integrate PostHog into this ${
    config.metadata.name
  } project.

Project context:
- Framework: ${config.metadata.name} ${context.frameworkVersion}
- TypeScript: ${context.typescript ? 'Yes' : 'No'}
- PostHog API Key: ${context.projectApiKey}
- PostHog Host: ${context.host}${additionalContext}

Instructions:

1. ${config.prompts.projectTypeDetection}

2. Call the PostHog MCP's resource for setup: posthog://workflows/basic-integration/begin
3. Follow all instructions provided; do package installation as soon as possible.
4. Set up environment variables for PostHog in a .env file with the API key and host provided above, using the appropriate naming convention for ${
    config.metadata.name
  }. Make sure to use these environment variables in the code files you create instead of hardcoding the API key and host.

The PostHog MCP will provide specific integration code and instructions. Please follow them carefully.

For package installation: ${config.prompts.packageInstallation}

SECURITY: When generating any documentation or report files (like posthog-setup-report.md):
- NEVER include the actual PostHog API key in documentation files
- Instead of: POSTHOG_API_KEY=phc_actual_key_here
- Use: POSTHOG_API_KEY=\${POSTHOG_API_KEY}  # Set in .env file
- Or: POSTHOG_API_KEY=<your-api-key-from-env>
- The .env file can contain the real key, but markdown/documentation files must not expose it

Before beginning, confirm that you can access the PostHog MCP. If the PostHog MCP is not accessible, emit the following string:

${AgentSignals.ERROR_MCP_MISSING} Could not access the PostHog MCP.

If the PostHog MCP is accessible, attempt to access the setup resource. If the setup resource is not accessible, emit the following string:

${AgentSignals.ERROR_RESOURCE_MISSING} Could not access the setup resource.

`;
}
