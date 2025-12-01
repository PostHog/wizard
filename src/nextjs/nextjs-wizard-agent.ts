/* Simplified Next.js wizard using posthog-agent with PostHog MCP */
import type { WizardOptions } from '../utils/types';
import type { FrameworkConfig } from '../lib/framework-config';
import { enableDebugLogs } from '../utils/debug';
import { runAgentWizard } from '../lib/agent-runner';
import { Integration } from '../lib/constants';
import { getPackageVersion } from '../utils/package-json';
import {
  getNextJsRouter,
  getNextJsVersionBucket,
  getNextJsRouterName,
  NextJsRouter,
} from './utils';

/**
 * Next.js framework configuration for the universal agent runner.
 */
const NEXTJS_AGENT_CONFIG: FrameworkConfig = {
  metadata: {
    name: 'Next.js',
    integration: Integration.nextjs,
    docsUrl: 'https://posthog.com/docs/libraries/next-js',
    abortMessage:
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
  },

  prompts: {
    getAdditionalContextLines: (context: any) => {
      const router = context.router as NextJsRouter;
      const routerType = router === NextJsRouter.APP_ROUTER ? 'app' : 'pages';
      return [`Router: ${routerType}`];
    },
  },

  ui: {
    welcomeMessage: 'PostHog Next.js wizard (agent-powered)',
    spinnerMessage:
      'Writing your PostHog setup with events, error capture and more...',
    successMessage: 'PostHog integration complete',
    estimatedDurationMinutes: 8,
    getOutroChanges: (context: any) => {
      const router = context.router as NextJsRouter;
      const routerName = getNextJsRouterName(router);
      return [
        `Analyzed your Next.js project structure (${routerName})`,
        `Created and configured PostHog initializers`,
        `Integrated PostHog into your application`,
      ];
    },
    getOutroNextSteps: () => {
      return [
        'Start your development server to see PostHog in action',
        'Visit your PostHog dashboard to see incoming events',
      ];
    },
  },
};

/**
 * Next.js wizard powered by the universal agent runner.
 */
export async function runNextjsWizardAgent(
  options: WizardOptions,
): Promise<void> {
  if (options.debug) {
    enableDebugLogs();
  }

  await runAgentWizard(NEXTJS_AGENT_CONFIG, options);
}
