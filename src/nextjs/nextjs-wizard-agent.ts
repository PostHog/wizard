/* Simplified Next.js wizard using posthog-agent with PostHog MCP */
import type { WizardOptions } from '../utils/types';
import { enableDebugLogs } from '../utils/debug';
import { runAgentWizard } from '../lib/agent-runner';
import { Integration } from '../lib/constants';
import { getPackageVersion } from '../utils/package-json';
import { getPackageDotJson } from '../utils/clack-utils';
import clack from '../utils/clack';
import chalk from 'chalk';
import * as semver from 'semver';
import {
  getNextJsRouter,
  getNextJsVersionBucket,
  getNextJsRouterName,
  NextJsRouter,
} from './utils';

/**
 * Next.js framework configuration for the universal agent runner.
 */
const MINIMUM_NEXTJS_VERSION = '15.3.0';

const NEXTJS_AGENT_CONFIG = {
  metadata: {
    name: 'Next.js',
    integration: Integration.nextjs,
    docsUrl: 'https://posthog.com/docs/libraries/next-js',
    unsupportedVersionDocsUrl: 'https://posthog.com/docs/libraries/next-js',
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
    getEnvVars: (apiKey: string, host: string) => ({
      NEXT_PUBLIC_POSTHOG_KEY: apiKey,
      NEXT_PUBLIC_POSTHOG_HOST: host,
    }),
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

  // Check Next.js version - agent wizard requires >= 15.3.0
  const packageJson = await getPackageDotJson(options);
  const nextVersion = getPackageVersion('next', packageJson);

  if (nextVersion) {
    const coercedVersion = semver.coerce(nextVersion);
    if (coercedVersion && semver.lt(coercedVersion, MINIMUM_NEXTJS_VERSION)) {
      const docsUrl =
        NEXTJS_AGENT_CONFIG.metadata.unsupportedVersionDocsUrl ??
        NEXTJS_AGENT_CONFIG.metadata.docsUrl;

      clack.log.warn(
        `Sorry: the wizard can't help you with Next.js ${nextVersion}. Upgrade to Next.js ${MINIMUM_NEXTJS_VERSION} or later, or check out the manual setup guide.`,
      );
      clack.log.info(`Setup Next.js manually: ${chalk.cyan(docsUrl)}`);
      clack.outro('PostHog wizard will see you next time!');
      return;
    }
  }

  await runAgentWizard(NEXTJS_AGENT_CONFIG, options);
}
