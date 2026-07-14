/* TanStack Start wizard using posthog-agent with PostHog MCP */
import type { WizardRunOptions } from '@utils/types';
import type { FrameworkConfig } from '@lib/framework-config';
import {
  detectNodePackageManagers,
  NODE_PACKAGE_MANAGERS,
} from '@lib/detection/package-manager';
import { Integration } from '@lib/constants';
import {
  getDeclaredVersion,
  getInstalledPackageVersion,
  hasDeclaredDependency,
  type PackageJson,
} from '@utils/package-json';
import { tryGetPackageJson } from '@utils/setup-utils';
import { getTanStackStartVersionBucket } from './utils';

type TanStackStartContext = Record<string, unknown>;

export const TANSTACK_START_AGENT_CONFIG: FrameworkConfig<TanStackStartContext> =
  {
    metadata: {
      name: 'TanStack Start',
      integration: Integration.tanstackStart,
      docsUrl: 'https://posthog.com/docs/libraries/react',
    },

    detection: {
      packageName: '@tanstack/react-start',
      packageDisplayName: 'TanStack Start',
      getVersion: (packageJson: unknown) =>
        getDeclaredVersion('@tanstack/react-start', packageJson as PackageJson),
      getVersionBucket: getTanStackStartVersionBucket,
      minimumVersion: '1.0.0',
      getInstalledVersion: (options: WizardRunOptions) =>
        Promise.resolve(
          getInstalledPackageVersion(
            '@tanstack/react-start',
            options.installDir,
          ),
        ),
      detect: async (options) => {
        const packageJson = await tryGetPackageJson(options);
        return packageJson
          ? hasDeclaredDependency('@tanstack/react-start', packageJson)
          : false;
      },
      detectPackageManager: detectNodePackageManagers,
      allowedPackageManagers: NODE_PACKAGE_MANAGERS,
    },

    environment: {
      uploadToHosting: false,
      getEnvVars: (apiKey: string, host: string) => ({
        VITE_PUBLIC_POSTHOG_PROJECT_TOKEN: apiKey,
        VITE_PUBLIC_POSTHOG_HOST: host,
      }),
    },

    analytics: {
      getTags: () => ({}),
    },

    prompts: {
      projectTypeDetection:
        'This is a JavaScript/TypeScript project. Look for package.json and lockfiles (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb) to confirm.',
      getAdditionalContextLines: () => {
        // TanStack Start always uses file-based routing (it's a full-stack framework built on TanStack Router)
        const frameworkId = 'react-tanstack-start';

        return [
          `Framework docs ID: ${frameworkId} (use posthog://docs/frameworks/${frameworkId} for documentation)`,
        ];
      },
    },

    ui: {
      successMessage: 'PostHog integration complete',
      estimatedDurationMinutes: 8,
      getOutroChanges: () => [
        `Analyzed your TanStack Start project structure`,
        `Created and configured PostHog initializers`,
        `Integrated PostHog into your application`,
      ],
      getOutroNextSteps: () => [
        'Start your development server to see PostHog in action',
        'Visit your PostHog dashboard to see incoming events',
      ],
    },
  };
