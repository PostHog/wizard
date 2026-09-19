/* Nuxt wizard using posthog-agent with PostHog MCP */
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
import { createVersionBucket } from '../../shared/semver.js';

const getNuxtVersionBucket = createVersionBucket();

type NuxtContext = {
  versionBucket?: string;
};

export const NUXT_AGENT_CONFIG: FrameworkConfig<NuxtContext> = {
  metadata: {
    name: 'Nuxt',
    integration: Integration.nuxt,
    docsUrl: 'https://posthog.com/docs/libraries/nuxt',
    gatherContext: async (options: WizardRunOptions) => {
      const packageJson = await tryGetPackageJson(options);
      if (!packageJson) return {};
      const version = getDeclaredVersion('nuxt', packageJson);
      const versionBucket = getNuxtVersionBucket(version);
      return { versionBucket };
    },
  },

  detection: {
    packageName: 'nuxt',
    packageDisplayName: 'Nuxt',
    getVersion: (packageJson: unknown) =>
      getDeclaredVersion('nuxt', packageJson as PackageJson),
    getVersionBucket: getNuxtVersionBucket,
    getInstalledVersion: (options: WizardRunOptions) =>
      Promise.resolve(getInstalledPackageVersion('nuxt', options.installDir)),
    detect: async (options) => {
      const packageJson = await tryGetPackageJson(options);
      return packageJson ? hasDeclaredDependency('nuxt', packageJson) : false;
    },
    detectPackageManager: detectNodePackageManagers,
  },

  environment: {
    uploadToHosting: true,
    getEnvVars: (apiKey: string, host: string) => ({
      NUXT_PUBLIC_POSTHOG_PROJECT_TOKEN: apiKey,
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
