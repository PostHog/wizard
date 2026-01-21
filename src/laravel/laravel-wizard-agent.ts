/* Laravel wizard using posthog-agent with PostHog MCP */
import type { WizardOptions } from '../utils/types';
import type { FrameworkConfig } from '../lib/framework-config';
import { enableDebugLogs } from '../utils/debug';
import { runAgentWizard } from '../lib/agent-runner';
import { Integration } from '../lib/constants';
import clack from '../utils/clack';
import chalk from 'chalk';
import * as semver from 'semver';
import {
  getLaravelVersion,
  getLaravelProjectType,
  getLaravelProjectTypeName,
  getLaravelVersionBucket,
  LaravelProjectType,
  findLaravelServiceProvider,
  findLaravelBootstrapFile,
  detectLaravelStructure,
} from './utils';

/**
 * Laravel framework configuration for the universal agent runner
 */
const MINIMUM_LARAVEL_VERSION = '9.0.0';

const LARAVEL_AGENT_CONFIG: FrameworkConfig = {
  metadata: {
    name: 'Laravel',
    integration: Integration.laravel,
    docsUrl: 'https://posthog.com/docs/libraries/php',
    unsupportedVersionDocsUrl: 'https://posthog.com/docs/libraries/php',
    gatherContext: async (options: WizardOptions) => {
      const projectType = await getLaravelProjectType(options);
      const serviceProvider = await findLaravelServiceProvider(options);
      const bootstrapFile = findLaravelBootstrapFile(options);
      const laravelStructure = detectLaravelStructure(options);

      return {
        projectType,
        serviceProvider,
        bootstrapFile,
        laravelStructure,
      };
    },
  },

  detection: {
    packageName: 'laravel/framework',
    packageDisplayName: 'Laravel',
    usesPackageJson: false,
    getVersion: (_packageJson: any) => {
      // For Laravel, we don't use package.json. Version is extracted separately
      // from composer.json in the wizard entry point
      return undefined;
    },
    getVersionBucket: getLaravelVersionBucket,
  },

  environment: {
    uploadToHosting: false,
    getEnvVars: (apiKey: string, host: string) => ({
      POSTHOG_API_KEY: apiKey,
      POSTHOG_HOST: host,
    }),
  },

  analytics: {
    getTags: (context: any) => {
      const projectType = context.projectType as LaravelProjectType;
      return {
        projectType: projectType || 'unknown',
        laravelStructure: context.laravelStructure || 'unknown',
      };
    },
  },

  prompts: {
    projectTypeDetection:
      'This is a PHP/Laravel project. Look for composer.json, artisan CLI, and app/ directory structure to confirm. Check for Laravel-specific packages like laravel/framework.',
    packageInstallation:
      'Use Composer to install packages. Run `composer require posthog/posthog-php` without pinning a specific version.',
    getAdditionalContextLines: (context: any) => {
      const projectType = context.projectType as LaravelProjectType;
      const projectTypeName = projectType
        ? getLaravelProjectTypeName(projectType)
        : 'unknown';

      const lines = [
        `Project type: ${projectTypeName}`,
        `Framework docs ID: php (use posthog://docs/frameworks/php for documentation)`,
        `Laravel structure: ${context.laravelStructure} (affects where to add configuration)`,
      ];

      if (context.serviceProvider) {
        lines.push(`Service provider: ${context.serviceProvider}`);
      }

      if (context.bootstrapFile) {
        lines.push(`Bootstrap file: ${context.bootstrapFile}`);
      }

      // Add Laravel-specific guidance based on version structure
      if (context.laravelStructure === 'latest') {
        lines.push(
          'Note: Laravel 11+ uses simplified bootstrap/app.php for middleware and providers',
        );
      } else {
        lines.push(
          'Note: Use app/Http/Kernel.php for middleware, app/Providers for service providers',
        );
      }

      return lines;
    },
  },

  ui: {
    successMessage: 'PostHog integration complete',
    estimatedDurationMinutes: 5,
    getOutroChanges: (context: any) => {
      const projectType = context.projectType as LaravelProjectType;
      const projectTypeName = projectType
        ? getLaravelProjectTypeName(projectType)
        : 'Laravel';

      const changes = [
        `Analyzed your ${projectTypeName} project structure`,
        `Installed the PostHog PHP package via Composer`,
        `Configured PostHog in your Laravel application`,
      ];

      if (context.laravelStructure === 'latest') {
        changes.push('Added PostHog initialization to bootstrap/app.php');
      } else {
        changes.push('Created a PostHog service provider for initialization');
      }

      if (projectType === LaravelProjectType.INERTIA) {
        changes.push('Configured PostHog to work with Inertia.js');
      }

      if (projectType === LaravelProjectType.LIVEWIRE) {
        changes.push('Configured PostHog to work with Livewire');
      }

      return changes;
    },
    getOutroNextSteps: () => [
      'Start your Laravel development server with `php artisan serve`',
      'Visit your PostHog dashboard to see incoming events',
      'Use PostHog::capture() to track custom events',
      'Use PostHog::identify() to associate events with users',
    ],
  },
};

/**
 * Laravel wizard powered by the universal agent runner.
 */
export async function runLaravelWizardAgent(
  options: WizardOptions,
): Promise<void> {
  if (options.debug) {
    enableDebugLogs();
  }

  // Check Laravel version - agent wizard requires >= 9.0.0
  const laravelVersion = getLaravelVersion(options);

  if (laravelVersion) {
    const coercedVersion = semver.coerce(laravelVersion);
    if (coercedVersion && semver.lt(coercedVersion, MINIMUM_LARAVEL_VERSION)) {
      const docsUrl =
        LARAVEL_AGENT_CONFIG.metadata.unsupportedVersionDocsUrl ??
        LARAVEL_AGENT_CONFIG.metadata.docsUrl;

      clack.log.warn(
        `Sorry: the wizard can't help you with Laravel ${laravelVersion}. Upgrade to Laravel ${MINIMUM_LARAVEL_VERSION} or later, or check out the manual setup guide.`,
      );
      clack.log.info(`Setup Laravel manually: ${chalk.cyan(docsUrl)}`);
      clack.outro('PostHog wizard will see you next time!');
      return;
    }
  }

  await runAgentWizard(LARAVEL_AGENT_CONFIG, options);
}
