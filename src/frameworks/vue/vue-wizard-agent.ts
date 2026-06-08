/* Vue wizard using posthog-agent with PostHog MCP */
import type { FrameworkConfig } from '@lib/framework-config';
import { detectNodePackageManagers } from '@lib/detection/package-manager';
import { Integration } from '@lib/constants';
import {
  getDeclaredVersion,
  getInstalledPackageVersion,
  hasDeclaredDependency,
  type PackageJson,
} from '@utils/package-json';
import { tryGetPackageJson } from '@utils/setup-utils';
import { createVersionBucket } from '@utils/semver';

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
      getDeclaredVersion('vue', packageJson as PackageJson),
    getVersionBucket: getVueVersionBucket,
    getInstalledVersion: (options) =>
      Promise.resolve(getInstalledPackageVersion('vue', options.installDir)),
    detect: async (options) => {
      const packageJson = await tryGetPackageJson(options);
      return packageJson ? hasDeclaredDependency('vue', packageJson) : false;
    },
    detectPackageManager: detectNodePackageManagers,
  },

  environment: {
    uploadToHosting: true,
    getEnvVars: (apiKey: string, host: string) => ({
      VITE_POSTHOG_PROJECT_TOKEN: apiKey,
      VITE_POSTHOG_HOST: host,
    }),
  },

  analytics: {
    getTags: () => ({}),
  },

  prompts: {
    projectTypeDetection:
      'This is a JavaScript/TypeScript project. Look for package.json and lockfiles (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb) to confirm.',
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
