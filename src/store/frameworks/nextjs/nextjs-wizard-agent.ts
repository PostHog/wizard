/* Simplified Next.js wizard using posthog-agent with PostHog MCP */
import type { WizardRunOptions } from '../../shared/types.js';
import type { FrameworkConfig } from '../../framework-config.js';
import { detectNodePackageManagers } from '../../detection/package-manager.js';
import { Integration } from '../../shared/constants.js';
import {
  getDeclaredVersion,
  getInstalledPackageVersion,
  hasDeclaredDependency,
  type PackageJson,
} from '../../shared/package-json.js';
import { tryGetPackageJson } from '../../shared/setup-utils.js';
import { getUI } from '../../ui/index.js';
import {
  getNextJsRouter,
  getNextJsVersionBucket,
  getNextJsRouterName,
  NextJsRouter,
} from './utils.js';

type NextjsContext = {
  router?: NextJsRouter;
};

export const NEXTJS_AGENT_CONFIG: FrameworkConfig<NextjsContext> = {
  metadata: {
    name: 'Next.js',
    integration: Integration.nextjs,
    docsUrl: 'https://posthog.com/docs/libraries/next-js',
    unsupportedVersionDocsUrl: 'https://posthog.com/docs/libraries/next-js',
    gatherContext: async (options: WizardRunOptions) => {
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
      getDeclaredVersion('next', packageJson as PackageJson),
    getVersionBucket: getNextJsVersionBucket,
    minimumVersion: '15.3.0',
    getInstalledVersion: (options: WizardRunOptions) =>
      Promise.resolve(getInstalledPackageVersion('next', options.installDir)),
    detect: async (options) => {
      const packageJson = await tryGetPackageJson(options);
      return packageJson ? hasDeclaredDependency('next', packageJson) : false;
    },
    detectPackageManager: detectNodePackageManagers,
  },

  environment: {
    uploadToHosting: true,
    getEnvVars: (apiKey: string, host: string) => ({
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: apiKey,
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
