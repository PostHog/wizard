/* TanStack Start wizard using posthog-agent with PostHog MCP */
import type { WizardOptions } from '../utils/types';
import type { FrameworkConfig } from '../lib/framework-config';
import { Integration } from '../lib/constants';
import {
  getPackageVersion,
  hasPackageInstalled,
  type PackageDotJson,
} from '../utils/package-json';
import { getPackageDotJson, tryGetPackageJson } from '../utils/clack-utils';
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
        getPackageVersion(
          '@tanstack/react-start',
          packageJson as PackageDotJson,
        ),
      getVersionBucket: getTanStackStartVersionBucket,
      minimumVersion: '1.0.0',
      getInstalledVersion: async (options: WizardOptions) => {
        const packageJson = await getPackageDotJson(options);
        return getPackageVersion('@tanstack/react-start', packageJson);
      },
      detect: async (options) => {
        const packageJson = await tryGetPackageJson(options);
        return packageJson
          ? hasPackageInstalled('@tanstack/react-start', packageJson)
          : false;
      },
    },

    environment: {
      uploadToHosting: false,
      getEnvVars: (apiKey: string, host: string) => ({
        VITE_PUBLIC_POSTHOG_KEY: apiKey,
        VITE_PUBLIC_POSTHOG_HOST: host,
      }),
    },

    analytics: {
      getTags: () => ({}),
    },

    prompts: {
      projectTypeDetection:
        'This is a JavaScript/TypeScript project. Look for package.json and lockfiles (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb) to confirm.',
      packageInstallation:
        'Look for lockfiles to determine the package manager (npm, yarn, pnpm, bun). Do not manually edit package.json.',
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
