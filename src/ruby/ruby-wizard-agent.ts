/* Generic Ruby language wizard using posthog-agent with PostHog MCP */
import type { WizardOptions } from '../utils/types';
import type { FrameworkConfig } from '../lib/framework-config';
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
    packageInstallation:
      "Use Bundler if a Gemfile is present (add `gem 'posthog-ruby'` and run `bundle install`). Otherwise use `gem install posthog-ruby`. Do not pin a specific version.",
    getAdditionalContextLines: (context) => {
      const packageManagerName = context.packageManager
        ? getPackageManagerName(context.packageManager)
        : 'unknown';

      const lines = [
        `Package manager: ${packageManagerName}`,
        `Framework docs ID: ruby (use posthog://docs/frameworks/ruby for documentation)`,
        `Project type: Generic Ruby application (CLI, script, gem, worker, etc.)`,
        ``,
        `## CRITICAL: Ruby PostHog Best Practices`,
        ``,
        `### 1. Gem Name vs Require`,
        `The gem is named posthog-ruby but you require it as 'posthog':`,
        `  gem 'posthog-ruby'  # in Gemfile`,
        `  require 'posthog'   # in code (NOT require 'posthog-ruby')`,
        ``,
        `### 2. Use Instance-Based API (REQUIRED for scripts/CLIs)`,
        `Use PostHog::Client.new for scripts and standalone applications:`,
        ``,
        `client = PostHog::Client.new(`,
        `  api_key: ENV['POSTHOG_API_KEY'],`,
        `  host: ENV['POSTHOG_HOST'] || 'https://us.i.posthog.com'`,
        `)`,
        ``,
        `### 3. MUST Call shutdown Before Exit`,
        `In scripts and CLIs, you MUST call client.shutdown or events will be lost:`,
        ``,
        `begin`,
        `  client.capture(distinct_id: 'user_123', event: 'my_event')`,
        `ensure`,
        `  client.shutdown`,
        `end`,
        ``,
        `### 4. capture_exception Takes Positional Args`,
        `client.capture_exception(exception, distinct_id, additional_properties)`,
        `Do NOT use keyword arguments for capture_exception.`,
        ``,
        `### 5. NEVER Send PII`,
        `Do NOT include emails, names, phone numbers, or user content in event properties.`,
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
