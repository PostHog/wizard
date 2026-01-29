/* Laravel wizard using posthog-agent with PostHog MCP */
import type { WizardOptions } from '../utils/types';
import type { FrameworkConfig } from '../lib/framework-config';
import { runAgentWizard } from '../lib/agent-runner';
import { Integration } from '../lib/constants';
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
    getVersion: (_packageJson: any) => undefined,
    getVersionBucket: getLaravelVersionBucket,
    minimumVersion: '9.0.0',
    getInstalledVersion: (options: WizardOptions) =>
      Promise.resolve(getLaravelVersion(options)),
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
  await runAgentWizard(LARAVEL_AGENT_CONFIG, options);
}
