/* Simplified Next.js wizard using posthog-agent with PostHog MCP */
import {
  abort,
  askForAIConsent,
  confirmContinueIfNoOrDirtyGitRepo,
  ensurePackageIsInstalled,
  getOrAskForProjectData,
  getPackageDotJson,
  isUsingTypeScript,
  printWelcome,
} from '../utils/clack-utils';
import { getPackageVersion } from '../utils/package-json';
import { getNextJsRouter, getNextJsVersionBucket, NextJsRouter } from './utils';
import clack from '../utils/clack';
import { Integration, WIZARD_INTERACTION_EVENT_NAME } from '../lib/constants';
import { analytics } from '../utils/analytics';
import type { WizardOptions } from '../utils/types';
import { askForCloudRegion } from '../utils/clack-utils';
import { getCloudUrlFromRegion } from '../utils/urls';
import chalk from 'chalk';
import {
  addOrUpdateEnvironmentVariablesStep,
  addMCPServerToClientsStep,
  uploadEnvironmentVariablesStep,
} from '../steps';
import { enableDebugLogs } from '../utils/debug';
import { initializeAgent, runAgent } from '../lib/agent-interface';

/**
 * Simplified Next.js wizard that delegates to PostHog MCP's /integrate command
 */
export async function runNextjsWizardAgent(
  options: WizardOptions,
): Promise<void> {
  if (options.debug) {
    enableDebugLogs();
  }

  printWelcome({
    wizardName: 'PostHog Next.js wizard (agent-powered)',
  });

  clack.log.info(
    '🧙 The wizard has chosen you to try the next-generation agent integration for Next.js.\n\nStand by for the good stuff, and let me know how it goes:\n\ndanilo@posthog.com',
  );

  const aiConsent = await askForAIConsent(options);

  if (!aiConsent) {
    await abort(
      'This wizard uses an LLM agent to intelligently modify your project. Please view the docs to setup Next.js manually instead: https://posthog.com/docs/libraries/next-js',
      0,
    );
  }

  const cloudRegion = options.cloudRegion ?? (await askForCloudRegion());
  const typeScriptDetected = isUsingTypeScript(options);

  await confirmContinueIfNoOrDirtyGitRepo(options);

  const packageJson = await getPackageDotJson(options);
  await ensurePackageIsInstalled(packageJson, 'next', 'Next.js');

  const nextVersion = getPackageVersion('next', packageJson);
  analytics.setTag('nextjs-version', getNextJsVersionBucket(nextVersion));

  analytics.capture(WIZARD_INTERACTION_EVENT_NAME, {
    action: 'started agent integration',
  });

  const { projectApiKey, host, accessToken } = await getOrAskForProjectData({
    ...options,
    cloudRegion,
  });

  const router = await getNextJsRouter(options);
  const routerType = router === NextJsRouter.APP_ROUTER ? 'app' : 'pages';

  const spinner = clack.spinner();

  const agent = await initializeAgent(
    {
      workingDirectory: options.installDir,
      posthogMcpUrl: 'https://mcp.posthog.com/mcp',
      posthogApiKey: accessToken,
      debug: false,
    },
    options,
    spinner,
  );

  const integrationPrompt = buildIntegrationPrompt({
    framework: 'Next.js',
    version: nextVersion || 'latest',
    router: routerType,
    typescript: typeScriptDetected,
    projectApiKey,
    host,
  });

  await runAgent(agent, integrationPrompt, options, spinner, {
    estimatedDurationMinutes: 8,
    spinnerMessage:
      'Writing your PostHog setup with events, error capture and more...',
    successMessage: 'PostHog integration complete',
    errorMessage: 'Integration failed',
  });

  const { relativeEnvFilePath, addedEnvVariables } =
    await addOrUpdateEnvironmentVariablesStep({
      variables: {
        NEXT_PUBLIC_POSTHOG_KEY: projectApiKey,
        NEXT_PUBLIC_POSTHOG_HOST: host,
      },
      installDir: options.installDir,
      integration: Integration.nextjs,
    });

  const uploadedEnvVars = await uploadEnvironmentVariablesStep(
    {
      NEXT_PUBLIC_POSTHOG_KEY: projectApiKey,
      NEXT_PUBLIC_POSTHOG_HOST: host,
    },
    {
      integration: Integration.nextjs,
      options,
    },
  );

  await addMCPServerToClientsStep({
    cloudRegion,
    integration: Integration.nextjs,
  });

  const continueUrl = options.signup
    ? `${getCloudUrlFromRegion(cloudRegion)}/products?source=wizard`
    : undefined;

  const changes = [
    addedEnvVariables
      ? `Added your Project API key to your ${relativeEnvFilePath} file`
      : '',
    uploadedEnvVars.length > 0
      ? `Uploaded your Project API key to your hosting provider`
      : '',
  ].filter(Boolean);

  const nextSteps = [
    uploadedEnvVars.length === 0
      ? `Upload your Project API key to your hosting provider`
      : '',
  ].filter(Boolean);

  const outroMessage = `
${chalk.green('Successfully installed PostHog!')}

${chalk.cyan('What the agent did:')}
• Analyzed your Next.js project structure (${routerType} router)
• Created and configured PostHog initializers
• Integrated PostHog into your application
${changes.map((change) => `• ${change}`).join('\n')}

${chalk.yellow('Next steps:')}
• Start your development server to see PostHog in action
• Visit your PostHog dashboard to see incoming events
${nextSteps.map((step) => `• ${step}`).join('\n')}

Learn more about PostHog + Next.js: ${chalk.cyan(
    'https://posthog.com/docs/libraries/next-js',
  )}
${continueUrl ? `\nContinue onboarding: ${chalk.cyan(continueUrl)}\n` : ``}
${chalk.dim(
  'Note: This wizard uses an LLM agent to analyze and modify your project. Please review the changes made.',
)}

${chalk.dim(`How did this work for you? Drop me a line: danilo@posthog.com`)}`;

  clack.outro(outroMessage);

  await analytics.shutdown('success');
}

function buildIntegrationPrompt(context: {
  framework: string;
  version: string;
  router: string;
  typescript: boolean;
  projectApiKey: string;
  host: string;
}): string {
  return `You have access to the PostHog MCP server which provides an integration resource to integrate PostHog into this ${
    context.framework
  } project.

Project context:
- Framework: ${context.framework} ${context.version}
- Router: ${context.router}
- TypeScript: ${context.typescript ? 'Yes' : 'No'}
- PostHog API Key: ${context.projectApiKey}
- PostHog Host: ${context.host}

Instructions:
1. Call the PostHog MCP's resource for setup: posthog://integration/workflow/setup/begin
2. Follow all instructions provided

The PostHog MCP will provide specific integration code and instructions. Please follow them carefully. Be sure to look for lockfiles to determine the appropriate package manager to use when installing PostHog. Do not manually edit the package.json file.
`;
}
