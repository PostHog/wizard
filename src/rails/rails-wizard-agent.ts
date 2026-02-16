/* Ruby on Rails wizard using posthog-agent with PostHog MCP */
import type { WizardOptions } from '../utils/types';
import type { FrameworkConfig } from '../lib/framework-config';
import { Integration } from '../lib/constants';
import {
  getRailsVersion,
  getRailsProjectType,
  getRailsProjectTypeName,
  getRailsVersionBucket,
  RailsProjectType,
  findInitializersDir,
  isRailsProject,
} from './utils';

type RailsContext = {
  projectType?: RailsProjectType;
  initializersDir?: string;
};

export const RAILS_AGENT_CONFIG: FrameworkConfig<RailsContext> = {
  metadata: {
    name: 'Ruby on Rails',
    integration: Integration.rails,
    beta: true,
    docsUrl: 'https://posthog.com/docs/libraries/ruby-on-rails',
    unsupportedVersionDocsUrl: 'https://posthog.com/docs/libraries/ruby',
    gatherContext: (options: WizardOptions) => {
      const projectType = getRailsProjectType(options);
      const initializersDir = findInitializersDir(options);
      return Promise.resolve({ projectType, initializersDir });
    },
  },

  detection: {
    packageName: 'rails',
    packageDisplayName: 'Ruby on Rails',
    usesPackageJson: false,
    getVersion: () => undefined,
    getVersionBucket: getRailsVersionBucket,
    minimumVersion: '6.0.0',
    getInstalledVersion: (options: WizardOptions) =>
      Promise.resolve(getRailsVersion(options)),
    detect: async (options) => isRailsProject(options),
  },

  environment: {
    uploadToHosting: false,
    getEnvVars: (apiKey: string, host: string) => ({
      POSTHOG_API_KEY: apiKey,
      POSTHOG_HOST: host,
    }),
  },

  analytics: {
    getTags: (context) => ({
      projectType: context.projectType || 'unknown',
    }),
  },

  prompts: {
    projectTypeDetection:
      'This is a Ruby on Rails project. Look for Gemfile, config/application.rb, bin/rails, and config/routes.rb to confirm.',
    packageInstallation:
      "Use Bundler to install gems. Add `gem 'posthog-ruby'` and `gem 'posthog-rails'` to the Gemfile and run `bundle install`. Do not pin specific versions.",
    getAdditionalContextLines: (context) => {
      const projectTypeName = context.projectType
        ? getRailsProjectTypeName(context.projectType)
        : 'unknown';

      const lines = [
        `Project type: ${projectTypeName}`,
        `Framework docs ID: ruby-on-rails (use posthog://docs/frameworks/ruby-on-rails for documentation)`,
      ];

      if (context.initializersDir) {
        lines.push(`Initializers directory: ${context.initializersDir}`);
      }

      if (context.projectType === RailsProjectType.API) {
        lines.push(
          'Note: This is an API-only Rails app — skip frontend posthog-js integration',
        );
      }

      return lines;
    },
  },

  ui: {
    successMessage: 'PostHog integration complete',
    estimatedDurationMinutes: 5,
    getOutroChanges: (context) => {
      const projectTypeName = context.projectType
        ? getRailsProjectTypeName(context.projectType)
        : 'Rails';

      const changes = [
        `Analyzed your ${projectTypeName} project structure`,
        `Installed the posthog-ruby and posthog-rails gems via Bundler`,
        `Created PostHog initializer in config/initializers/posthog.rb`,
        `Configured automatic exception capture and ActiveJob instrumentation`,
      ];

      if (context.projectType !== RailsProjectType.API) {
        changes.push(
          'Added posthog-js snippet to the layout template for frontend tracking',
        );
      }

      return changes;
    },
    getOutroNextSteps: () => [
      'Start your Rails development server with `bin/rails server`',
      'Visit your PostHog dashboard to see incoming events',
      'Use PostHog.capture() to track custom events',
      'Use PostHog.identify() to associate events with users',
      'Define posthog_distinct_id on your User model for automatic user association',
    ],
  },
};
