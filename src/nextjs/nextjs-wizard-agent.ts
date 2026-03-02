/* Simplified Next.js wizard using posthog-agent with PostHog MCP */
import type { WizardOptions } from '../utils/types';
import type { FrameworkConfig } from '../lib/framework-config';
import { detectNodePackageManagers } from '../lib/package-manager-detection';
import { Integration } from '../lib/constants';
import {
  getPackageVersion,
  hasPackageInstalled,
  type PackageDotJson,
} from '../utils/package-json';
import { getPackageDotJson, tryGetPackageJson } from '../utils/setup-utils';
import { getUI } from '../ui';
import {
  getNextJsRouter,
  getNextJsVersionBucket,
  getNextJsRouterName,
  NextJsRouter,
} from './utils';

type NextjsContext = {
  router?: NextJsRouter;
};

export const NEXTJS_AGENT_CONFIG: FrameworkConfig<NextjsContext> = {
  metadata: {
    name: 'Next.js',
    integration: Integration.nextjs,
    docsUrl: 'https://posthog.com/docs/libraries/next-js',
    unsupportedVersionDocsUrl: 'https://posthog.com/docs/libraries/next-js',
    gatherContext: async (options: WizardOptions) => {
      const router = await getNextJsRouter(options);
      if (router) {
        const emoji =
          router === NextJsRouter.APP_ROUTER ? '\u{1F4F1}' : '\u{1F4C3}';
        getUI().setDetectedFramework(
          `Next.js ${getNextJsRouterName(router)} ${emoji}`,
        );
        return { router };
      }
      return {};
    },
    setup: {
      questions: [
        {
          key: 'router',
          message: 'Which Next.js router are you using?',
          options: [
            { label: 'App Router', value: NextJsRouter.APP_ROUTER },
            { label: 'Pages Router', value: NextJsRouter.PAGES_ROUTER },
          ],
          detect: async (opts) => {
            const result = await getNextJsRouter(opts);
            return result;
          },
        },
      ],
    },
  },

  detection: {
    packageName: 'next',
    packageDisplayName: 'Next.js',
    getVersion: (packageJson: unknown) =>
      getPackageVersion('next', packageJson as PackageDotJson),
    getVersionBucket: getNextJsVersionBucket,
    minimumVersion: '15.3.0',
    getInstalledVersion: async (options: WizardOptions) => {
      const packageJson = await getPackageDotJson(options);
      return getPackageVersion('next', packageJson);
    },
    detect: async (options) => {
      const packageJson = await tryGetPackageJson(options);
      return packageJson ? hasPackageInstalled('next', packageJson) : false;
    },
    detectPackageManager: detectNodePackageManagers,
  },

  environment: {
    uploadToHosting: true,
    getEnvVars: (apiKey: string, host: string) => ({
      NEXT_PUBLIC_POSTHOG_KEY: apiKey,
      NEXT_PUBLIC_POSTHOG_HOST: host,
    }),
  },

  analytics: {
    getTags: (context) => ({
      router: context.router === NextJsRouter.APP_ROUTER ? 'app' : 'pages',
    }),
  },

  prompts: {
    projectTypeDetection:
      'This is a JavaScript/TypeScript project. Look for package.json and lockfiles (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb) to confirm.',
    getAdditionalContextLines: (context) => {
      const routerType =
        context.router === NextJsRouter.APP_ROUTER ? 'app' : 'pages';
      return [`Router: ${routerType}`];
    },
  },

  ui: {
    successMessage: 'PostHog integration complete',
    estimatedDurationMinutes: 8,
    getOutroChanges: (context) => {
      const router = context.router ?? NextJsRouter.APP_ROUTER;
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
