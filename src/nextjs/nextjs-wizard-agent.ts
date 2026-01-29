/* Simplified Next.js wizard using posthog-agent with PostHog MCP */
import type { WizardOptions } from '../utils/types';
import { runAgentWizard } from '../lib/agent-runner';
import { Integration } from '../lib/constants';
import { getPackageVersion } from '../utils/package-json';
import { getPackageDotJson } from '../utils/clack-utils';
import {
  getNextJsRouter,
  getNextJsVersionBucket,
  getNextJsRouterName,
  NextJsRouter,
} from './utils';

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
    minimumVersion: '15.3.0',
    getInstalledVersion: async (options: WizardOptions) => {
      const packageJson = await getPackageDotJson(options);
      return getPackageVersion('next', packageJson);
    },
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
    projectTypeDetection:
      'This is a JavaScript/TypeScript project. Look for package.json and lockfiles (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb) to confirm.',
    packageInstallation:
      'Look for lockfiles to determine the package manager (npm, yarn, pnpm, bun). Do not manually edit package.json.',
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
  await runAgentWizard(NEXTJS_AGENT_CONFIG, options);
}
