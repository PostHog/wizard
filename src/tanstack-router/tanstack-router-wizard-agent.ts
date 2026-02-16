/* TanStack Router wizard using posthog-agent with PostHog MCP */
import type { WizardOptions } from '../utils/types';
import type { FrameworkConfig } from '../lib/framework-config';
import { detectNodePackageManagers } from '../lib/package-manager-detection';
import { Integration } from '../lib/constants';
import {
  getPackageVersion,
  hasPackageInstalled,
  type PackageDotJson,
} from '../utils/package-json';
import { getPackageDotJson, tryGetPackageJson } from '../utils/clack-utils';
import {
  getTanStackRouterMode,
  getTanStackRouterModeName,
  getTanStackRouterVersionBucket,
  TanStackRouterMode,
} from './utils';

type TanStackRouterContext = {
  routerMode?: TanStackRouterMode;
};

export const TANSTACK_ROUTER_AGENT_CONFIG: FrameworkConfig<TanStackRouterContext> =
  {
    metadata: {
      name: 'React (TanStack Router)',
      integration: Integration.tanstackRouter,
      docsUrl: 'https://posthog.com/docs/libraries/react',
      gatherContext: async (options: WizardOptions) => {
        const routerMode = await getTanStackRouterMode(options);
        return { routerMode };
      },
    },

    detection: {
      packageName: '@tanstack/react-router',
      packageDisplayName: 'TanStack Router',
      getVersion: (packageJson: unknown) =>
        getPackageVersion(
          '@tanstack/react-router',
          packageJson as PackageDotJson,
        ),
      getVersionBucket: getTanStackRouterVersionBucket,
      minimumVersion: '1.0.0',
      getInstalledVersion: async (options: WizardOptions) => {
        const packageJson = await getPackageDotJson(options);
        return getPackageVersion('@tanstack/react-router', packageJson);
      },
      detect: async (options) => {
        const packageJson = await tryGetPackageJson(options);
        if (!packageJson) {
          return false;
        }
        // Exclude TanStack Start projects (they have their own integration)
        if (hasPackageInstalled('@tanstack/react-start', packageJson)) {
          return false;
        }
        return hasPackageInstalled('@tanstack/react-router', packageJson);
      },
      detectPackageManager: detectNodePackageManagers,
    },

    environment: {
      uploadToHosting: false,
      getEnvVars: (apiKey: string, host: string) => ({
        VITE_PUBLIC_POSTHOG_KEY: apiKey,
        VITE_PUBLIC_POSTHOG_HOST: host,
      }),
    },

    analytics: {
      getTags: (context) => ({
        routerMode: context.routerMode || 'unknown',
      }),
    },

    prompts: {
      projectTypeDetection:
        'This is a JavaScript/TypeScript project. Look for package.json and lockfiles (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb) to confirm.',
      getAdditionalContextLines: (context) => {
        const routerMode = context.routerMode;
        const modeName = routerMode
          ? getTanStackRouterModeName(routerMode)
          : 'unknown';

        // Map router mode to framework ID for MCP docs resource
        const frameworkIdMap: Record<TanStackRouterMode, string> = {
          [TanStackRouterMode.FILE_BASED]: 'react-tanstack-router-file-based',
          [TanStackRouterMode.CODE_BASED]: 'react-tanstack-router-code-based',
        };

        const frameworkId = routerMode
          ? frameworkIdMap[routerMode]
          : 'react-tanstack-router-file-based';

        return [
          `Router mode: ${modeName}`,
          `Framework docs ID: ${frameworkId} (use posthog://docs/frameworks/${frameworkId} for documentation)`,
        ];
      },
    },

    ui: {
      successMessage: 'PostHog integration complete',
      estimatedDurationMinutes: 8,
      getOutroChanges: (context) => {
        const modeName = context.routerMode
          ? getTanStackRouterModeName(context.routerMode)
          : 'TanStack Router';
        return [
          `Analyzed your React (TanStack Router) project structure (${modeName})`,
          `Created and configured PostHog initializers`,
          `Integrated PostHog into your application`,
        ];
      },
      getOutroNextSteps: () => [
        'Start your development server to see PostHog in action',
        'Visit your PostHog dashboard to see incoming events',
      ],
    },
  };
