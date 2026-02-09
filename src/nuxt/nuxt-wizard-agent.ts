/* Nuxt wizard using posthog-agent with PostHog MCP */
import type { WizardOptions } from '../utils/types';
import type { FrameworkConfig } from '../lib/framework-config';
import { Integration } from '../lib/constants';
import {
  getPackageVersion,
  hasPackageInstalled,
  type PackageDotJson,
} from '../utils/package-json';
import { getPackageDotJson, tryGetPackageJson } from '../utils/clack-utils';
import { createVersionBucket } from '../utils/semver';

const getNuxtVersionBucket = createVersionBucket();

type NuxtContext = {
  versionBucket?: string;
};

export const NUXT_AGENT_CONFIG: FrameworkConfig<NuxtContext> = {
  metadata: {
    name: 'Nuxt',
    integration: Integration.nuxt,
    docsUrl: 'https://posthog.com/docs/libraries/nuxt',
    beta: true,
    gatherContext: async (options: WizardOptions) => {
      const packageJson = await getPackageDotJson(options);
      const version = getPackageVersion('nuxt', packageJson);
      const versionBucket = getNuxtVersionBucket(version);
      return { versionBucket };
    },
  },

  detection: {
    packageName: 'nuxt',
    packageDisplayName: 'Nuxt',
    getVersion: (packageJson: unknown) =>
      getPackageVersion('nuxt', packageJson as PackageDotJson),
    getVersionBucket: getNuxtVersionBucket,
    getInstalledVersion: async (options: WizardOptions) => {
      const packageJson = await getPackageDotJson(options);
      return getPackageVersion('nuxt', packageJson);
    },
    detect: async (options) => {
      const packageJson = await tryGetPackageJson(options);
      return packageJson ? hasPackageInstalled('nuxt', packageJson) : false;
    },
  },

  environment: {
    uploadToHosting: true,
    getEnvVars: (apiKey: string, host: string) => ({
      NUXT_PUBLIC_POSTHOG_KEY: apiKey,
      NUXT_PUBLIC_POSTHOG_HOST: host,
    }),
  },

  analytics: {
    getTags: (context) => ({
      ...(context.versionBucket
        ? { versionBucket: context.versionBucket }
        : {}),
    }),
  },

  prompts: {
    projectTypeDetection:
      'This is a JavaScript/TypeScript project. Look for package.json and lockfiles (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb) to confirm.',
    packageInstallation:
      'Look for lockfiles to determine the package manager (npm, yarn, pnpm, bun). Do not manually edit package.json.',
    getAdditionalContextLines: (context) => {
      const lines: string[] = [];
      if (context.versionBucket) {
        lines.push(`Nuxt version: ${context.versionBucket}`);
      }
      const frameworkId = 'nuxt';
      lines.push(
        `Framework docs ID: ${frameworkId} (use posthog://docs/frameworks/${frameworkId} for documentation)`,
      );
      return lines;
    },
  },

  ui: {
    successMessage: 'PostHog integration complete',
    estimatedDurationMinutes: 5,
    getOutroChanges: () => [
      'Analyzed your Nuxt project structure',
      'Configured PostHog module/plugin',
      'Integrated PostHog into your application',
    ],
    getOutroNextSteps: () => [
      'Start your development server to see PostHog in action',
      'Visit your PostHog dashboard to see incoming events',
    ],
  },
};
