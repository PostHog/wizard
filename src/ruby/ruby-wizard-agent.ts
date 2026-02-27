/* Generic Ruby language wizard using posthog-agent with PostHog MCP */
import type { WizardOptions } from '../utils/types';
import type { FrameworkConfig } from '../lib/framework-config';
import { bundlerPackageManager } from '../lib/package-manager-detection';
import { Integration } from '../lib/constants';
import {
  getRubyVersion,
  getRubyVersionBucket,
  detectPackageManager,
  getPackageManagerName,
  RubyPackageManager,
  isRubyProject,
} from './utils';

type RubyContext = {
  packageManager?: RubyPackageManager;
};

export const RUBY_AGENT_CONFIG: FrameworkConfig<RubyContext> = {
  metadata: {
    name: 'Ruby',
    integration: Integration.ruby,
    beta: true,
    docsUrl: 'https://posthog.com/docs/libraries/ruby',
    gatherContext: (options: WizardOptions) => {
      const packageManager = detectPackageManager(options);
      return Promise.resolve({ packageManager });
    },
  },

  detection: {
    packageName: 'ruby',
    packageDisplayName: 'Ruby',
    usesPackageJson: false,
    getVersion: () => undefined,
    getVersionBucket: getRubyVersionBucket,
    minimumVersion: '2.7.0',
    getInstalledVersion: (options: WizardOptions) =>
      Promise.resolve(getRubyVersion(options)),
    detect: async (options) => isRubyProject(options),
    detectPackageManager: bundlerPackageManager,
  },

  environment: {
    uploadToHosting: false,
    getEnvVars: (apiKey: string, host: string) => ({
      POSTHOG_API_KEY: apiKey,
      POSTHOG_HOST: host,
    }),
  },

  analytics: {
    getTags: (context) => {
      const packageManagerName = context.packageManager
        ? getPackageManagerName(context.packageManager)
        : 'unknown';
      return {
        packageManager: packageManagerName,
      };
    },
  },

  prompts: {
    projectTypeDetection:
      'This is a Ruby project. Look for Gemfile, *.gemspec, .ruby-version, or *.rb files to confirm.',
    getAdditionalContextLines: (context) => {
      const packageManagerName = context.packageManager
        ? getPackageManagerName(context.packageManager)
        : 'unknown';

      const lines = [
        `Package manager: ${packageManagerName}`,
        `Framework docs ID: ruby (use posthog://docs/frameworks/ruby for documentation)`,
        `Project type: Generic Ruby application (CLI, script, gem, worker, etc.)`,
      ];

      return lines;
    },
  },

  ui: {
    successMessage: 'PostHog integration complete',
    estimatedDurationMinutes: 5,
    getOutroChanges: (context) => {
      const packageManagerName = context.packageManager
        ? getPackageManagerName(context.packageManager)
        : 'package manager';
      return [
        `Analyzed your Ruby project structure`,
        `Installed the posthog-ruby gem using ${packageManagerName}`,
        `Created PostHog initialization with instance-based API`,
        `Configured shutdown handler for proper event flushing`,
      ];
    },
    getOutroNextSteps: () => [
      'Use client.capture() for events and client.identify() for users',
      'Always call client.shutdown() before your application exits',
      'Visit your PostHog dashboard to see incoming events',
    ],
  },
};
