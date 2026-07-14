/* Angular wizard using posthog-agent with PostHog MCP */
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
      getDeclaredVersion('@angular/core', packageJson as PackageJson),
    getVersionBucket: getAngularVersionBucket,
    minimumVersion: '19.0.0',
    getInstalledVersion: (options: WizardRunOptions) =>
      Promise.resolve(
        getInstalledPackageVersion('@angular/core', options.installDir),
      ),
    detect: async (options) => {
      const packageJson = await tryGetPackageJson(options);
      return packageJson
        ? hasDeclaredDependency('@angular/core', packageJson)
        : false;
    },
    detectPackageManager: detectNodePackageManagers,
    allowedPackageManagers: NODE_PACKAGE_MANAGERS,
  },

  environment: {
    uploadToHosting: false,
    getEnvVars: (apiKey: string, host: string) => ({
      NG_APP_POSTHOG_PROJECT_TOKEN: apiKey,
      NG_APP_POSTHOG_HOST: host,
    }),
  },

  analytics: {
    getTags: () => ({}),
  },

  prompts: {
    projectTypeDetection:
      'This is an Angular project. Look for package.json, angular.json, and lockfiles (package-lock.json, yarn.lock, pnpm-lock.yaml) to confirm.',
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
