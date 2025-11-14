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
import clack from '../utils/clack';

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
    gatherContext: async (options: WizardOptions) => {
      const router = await getNextJsRouter(options);
      return { router };
    },
  },

  detection: {
    packageName: 'next',
    packageDisplayName: 'Next.js',
    getVersion: (packageJson: any) => getPackageVersion('next', packageJson),
    getVersionBucket: getNextJsVersionBucket,
  },

  environment: {
    uploadToHosting: true,
    expectedEnvVarSuffixes: ['POSTHOG_KEY', 'POSTHOG_HOST'],
  },

  analytics: {
    getTags: (context: any) => {
      const router = context.router as NextJsRouter;
      return {
        router: router === NextJsRouter.APP_ROUTER ? 'app' : 'pages',
      };
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

  clack.log.info(
    '🧙 The wizard has chosen you to try the next-generation agent integration for Next.js.\n\nStand by for the good stuff, and let me know how it goes:\n\ndanilo@posthog.com',
  );

  await runAgentWizard(NEXTJS_AGENT_CONFIG, options);
}
