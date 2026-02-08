/* Angular wizard using posthog-agent with PostHog MCP */
import type { WizardOptions } from '../utils/types';
import type { FrameworkConfig } from '../lib/framework-config';
import { Integration } from '../lib/constants';
import {
  getPackageVersion,
  hasPackageInstalled,
  type PackageDotJson,
} from '../utils/package-json';
import { getPackageDotJson, tryGetPackageJson } from '../utils/clack-utils';
import { getAngularVersionBucket } from './utils';

type AngularContext = Record<string, unknown>;

export const ANGULAR_AGENT_CONFIG: FrameworkConfig<AngularContext> = {
  metadata: {
    name: 'Angular',
    integration: Integration.angular,
    docsUrl: 'https://posthog.com/docs/libraries/angular',
  },

  detection: {
    packageName: '@angular/core',
    packageDisplayName: 'Angular',
    getVersion: (packageJson: unknown) =>
      getPackageVersion('@angular/core', packageJson as PackageDotJson),
    getVersionBucket: getAngularVersionBucket,
    minimumVersion: '19.0.0',
    getInstalledVersion: async (options: WizardOptions) => {
      const packageJson = await getPackageDotJson(options);
      return getPackageVersion('@angular/core', packageJson);
    },
    detect: async (options) => {
      const packageJson = await tryGetPackageJson(options);
      return packageJson
        ? hasPackageInstalled('@angular/core', packageJson)
        : false;
    },
  },

  environment: {
    uploadToHosting: false,
    getEnvVars: (apiKey: string, host: string) => ({
      POSTHOG_KEY: apiKey,
      POSTHOG_HOST: host,
    }),
  },

  analytics: {
    getTags: () => ({}),
  },

  prompts: {
    projectTypeDetection:
      'This is an Angular project. Look for package.json, angular.json, and lockfiles (package-lock.json, yarn.lock, pnpm-lock.yaml) to confirm.',
    packageInstallation:
      'Look for lockfiles to determine the package manager (npm, yarn, pnpm). Do not manually edit package.json.',
    getAdditionalContextLines: () => {
      const frameworkId = 'angular';

      return [
        `Framework docs ID: ${frameworkId} (use posthog://docs/frameworks/${frameworkId} for documentation)`,
        'Angular uses dependency injection for services. PostHog should be initialized as a service.',
        'For standalone components, ensure PostHog is properly provided in the application config.',
      ];
    },
  },

  ui: {
    successMessage: 'PostHog integration complete',
    estimatedDurationMinutes: 8,
    getOutroChanges: () => [
      `Analyzed your Angular project structure`,
      `Created and configured PostHog service`,
      `Integrated PostHog into your application`,
    ],
    getOutroNextSteps: () => [
      'Start your development server with `ng serve` to see PostHog in action',
      'Visit your PostHog dashboard to see incoming events',
    ],
  },
};
