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
  const packageJson = await getPackageDotJson(options);
  await ensurePackageIsInstalled(
    packageJson,
    config.detection.packageName,
    config.detection.packageDisplayName,
  );

  const frameworkVersion = config.detection.getVersion(packageJson);

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

  return `You have access to the PostHog MCP server which provides skills to integrate PostHog into this ${
    config.metadata.name
  } project.

Project context:
- Framework: ${config.metadata.name} ${context.frameworkVersion}
- TypeScript: ${context.typescript ? 'Yes' : 'No'}
- PostHog API Key: ${context.projectApiKey}
- PostHog Host: ${context.host}${additionalContext}

Instructions (follow these steps IN ORDER - do not skip or reorder):

STEP 1: List available skills from the PostHog MCP server using ListMcpResourcesTool.
   Review the skill descriptions and choose the one that best matches this project's framework and configuration.
   If no suitable skill is found, emit: ${
     AgentSignals.ERROR_RESOURCE_MISSING
   } Could not find a suitable skill for this project.

STEP 2: Fetch the chosen skill resource (e.g., posthog://skills/{skill-id}).
   The resource returns a shell command to install the skill.

STEP 3: Run the installation command using Bash:
   - Execute the EXACT command returned by the resource (do not modify it)
   - This will download and extract the skill to .claude/skills/{skill-id}/

STEP 4: Load the installed skill's SKILL.md file to understand what references are available.

STEP 5: Follow the skill's workflow files in sequence. Look for numbered workflow files in the references (e.g., files with patterns like "1.0-", "1.1-", "1.2-"). Start with the first one and proceed through each step until completion. Each workflow file will tell you what to do and which file comes next.

STEP 6: Set up environment variables for PostHog in a .env file with the API key and host provided above, using the appropriate naming convention for ${
    config.metadata.name
  }. Make sure to use these environment variables in the code files you create instead of hardcoding the API key and host.

Important: Look for lockfiles (pnpm-lock.yaml, package-lock.json, yarn.lock, bun.lockb) to determine the package manager. Do not manually edit package.json. Always install packages as a background task. Don't await completion; proceed with other work immediately after starting the installation.

`;
}
