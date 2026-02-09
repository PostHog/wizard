/* Vue wizard using posthog-agent with PostHog MCP */
import type { FrameworkConfig } from '../lib/framework-config';
import { Integration } from '../lib/constants';
import {
  getPackageVersion,
  hasPackageInstalled,
  type PackageDotJson,
} from '../utils/package-json';
import { getPackageDotJson, tryGetPackageJson } from '../utils/clack-utils';
import { createVersionBucket } from '../utils/semver';

const getVueVersionBucket = createVersionBucket();

type VueContext = Record<string, unknown>;

export const VUE_AGENT_CONFIG: FrameworkConfig<VueContext> = {
  metadata: {
    name: 'Vue',
    integration: Integration.vue,
    docsUrl: 'https://posthog.com/docs/libraries/vue',
    beta: true,
  },

  detection: {
    packageName: 'vue',
    packageDisplayName: 'Vue',
    getVersion: (packageJson: unknown) =>
      getPackageVersion('vue', packageJson as PackageDotJson),
    getVersionBucket: getVueVersionBucket,
    getInstalledVersion: async (options) => {
      const packageJson = await getPackageDotJson(options);
      return getPackageVersion('vue', packageJson);
    },
    detect: async (options) => {
      const packageJson = await tryGetPackageJson(options);
      return packageJson ? hasPackageInstalled('vue', packageJson) : false;
    },
  },

  environment: {
    uploadToHosting: true,
    getEnvVars: (apiKey: string, host: string) => ({
      VITE_POSTHOG_KEY: apiKey,
      VITE_POSTHOG_HOST: host,
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
      const frameworkId = 'vue';
      return [
        `Framework docs ID: ${frameworkId} (use posthog://docs/frameworks/${frameworkId} for documentation)`,
      ];
    },
  },

  ui: {
    successMessage: 'PostHog integration complete',
    estimatedDurationMinutes: 5,
    getOutroChanges: () => [
      'Analyzed your Vue project structure',
      'Created and configured PostHog initializers',
      'Integrated PostHog into your application',
    ],
    getOutroNextSteps: () => [
      'Start your development server to see PostHog in action',
      'Visit your PostHog dashboard to see incoming events',
    ],
  },
};
