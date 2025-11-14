import type { FrameworkConfig } from './framework-config';
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
import { initializeAgent, runAgent } from './agent-interface';
import { getCloudUrlFromRegion } from '../utils/urls';
import chalk from 'chalk';
import {
  addMCPServerToClientsStep,
  uploadEnvironmentVariablesStep,
} from '../steps';
import * as fs from 'fs';
import path from 'path';

/**
 * Universal agent-powered wizard runner.
 * Handles the complete flow for any framework using PostHog MCP integration.
 */
export async function runAgentWizard(
  config: FrameworkConfig,
  options: WizardOptions,
): Promise<void> {
  // Setup phase
  printWelcome({ wizardName: config.ui.welcomeMessage });

  const aiConsent = await askForAIConsent(options);
  if (!aiConsent) {
    await abort(config.metadata.abortMessage, 0);
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
  const agent = initializeAgent(
    {
      workingDirectory: options.installDir,
      posthogMcpUrl: 'https://mcp.posthog.com/mcp',
      posthogApiKey: accessToken,
      debug: false,
    },
    options,
    spinner,
  );

  await runAgent(agent, integrationPrompt, options, spinner, {
    estimatedDurationMinutes: config.ui.estimatedDurationMinutes,
    spinnerMessage: config.ui.spinnerMessage,
    successMessage: config.ui.successMessage,
    errorMessage: 'Integration failed',
  });

  // Parse .env file created by agent
  const envVars = parseEnvFile(
    options.installDir,
    config.environment.expectedEnvVarSuffixes,
  );

  // Upload environment variables to hosting providers (if configured)
  let uploadedEnvVars: string[] = [];
  if (config.environment.uploadToHosting && Object.keys(envVars).length > 0) {
    uploadedEnvVars = await uploadEnvironmentVariablesStep(envVars, {
      integration: config.metadata.integration,
      options,
    });
  }

  // Add MCP server to clients
  await addMCPServerToClientsStep({
    cloudRegion,
    integration: config.metadata.integration,
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

${chalk.dim(`How did this work for you? Drop me a line: danilo@posthog.com`)}`;

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
1. Call the PostHog MCP's resource for setup: posthog://workflows/basic-integration/begin
2. Follow all instructions provided
3. Set up environment variables for PostHog in a .env file with the API key and host provided above, using the appropriate naming convention for ${
    config.metadata.name
  }. Make sure to use these environment variables in the code files you create.

The PostHog MCP will provide specific integration code and instructions. Please follow them carefully. Be sure to look for lockfiles to determine the appropriate package manager to use when installing PostHog. Do not manually edit the package.json file.`;
}

/**
 * Parse .env file created by agent and extract variables matching expected suffixes.
 *
 * Looks for .env.local first, then .env.
 * Filters variables to only include those ending with expected suffixes.
 */
function parseEnvFile(
  installDir: string,
  expectedSuffixes: string[],
): Record<string, string> {
  // Check for .env.local first, then .env
  const dotEnvLocalPath = path.join(installDir, '.env.local');
  const dotEnvPath = path.join(installDir, '.env');

  let envFilePath: string | null = null;
  if (fs.existsSync(dotEnvLocalPath)) {
    envFilePath = dotEnvLocalPath;
  } else if (fs.existsSync(dotEnvPath)) {
    envFilePath = dotEnvPath;
  }

  if (!envFilePath) {
    // Agent didn't create .env file, return empty
    return {};
  }

  try {
    const content = fs.readFileSync(envFilePath, 'utf8');
    const lines = content.split('\n');
    const envVars: Record<string, string> = {};

    for (const line of lines) {
      const trimmed = line.trim();
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const [, key, value] = match;
        const cleanKey = key.trim();
        const cleanValue = value.trim();

        // Check if key ends with any expected suffix
        const matchesSuffix = expectedSuffixes.some((suffix) =>
          cleanKey.endsWith(suffix),
        );

        if (matchesSuffix) {
          envVars[cleanKey] = cleanValue;
        }
      }
    }

    return envVars;
  } catch (error) {
    // Failed to parse .env file, return empty
    clack.log.warning(
      `Failed to parse .env file: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    );
    return {};
  }
}
