/* Generic Ruby language wizard using posthog-agent with PostHog MCP */
import type { WizardOptions } from '../../utils/types';
import type { FrameworkConfig } from '../../lib/framework-config';
import { bundlerPackageManager } from '../../lib/detection/package-manager';
import { Integration } from '../../lib/constants';
import * as fs from 'node:fs';
import * as path from 'node:path';
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
  entryPoint?: string;
  detectedPatterns?: string[];
};

export const RUBY_AGENT_CONFIG: FrameworkConfig<RubyContext> = {
  metadata: {
    name: 'Ruby',
    integration: Integration.ruby,
    beta: true,
    docsUrl: 'https://posthog.com/docs/libraries/ruby',
    gatherContext: (options: WizardOptions) => {
      const { installDir } = options;
      const packageManager = detectPackageManager(options);
      const context: RubyContext = { packageManager };

      // Detect entry point
      const entryPointCandidates = [
        'app.rb',
        'main.rb',
        'run.rb',
        'lib/main.rb',
        'bin/main',
        'exe/main',
      ];
      for (const candidate of entryPointCandidates) {
        if (fs.existsSync(path.join(installDir, candidate))) {
          context.entryPoint = candidate;
          break;
        }
      }

      // Detect patterns from Gemfile
      let gemfileContent = '';
      try {
        gemfileContent = fs.readFileSync(
          path.join(installDir, 'Gemfile'),
          'utf-8',
        );
      } catch {
        /* no Gemfile */
      }

      const patternMarkers: Record<string, string[]> = {
        'Sinatra web app': ['sinatra'],
        'Grape API': ['grape'],
        'Hanami web app': ['hanami'],
        'background worker': ['sidekiq', 'resque'],
        CLI: ['thor', 'gli'],
        database: ['sequel', 'activerecord'],
      };

      const patterns = Object.entries(patternMarkers)
        .filter(([, gems]) =>
          gems.some((gem) =>
            new RegExp(`\\b${gem}\\b`, 'i').test(gemfileContent),
          ),
        )
        .map(([label]) => label);

      if (patterns.length > 0) {
        context.detectedPatterns = patterns;
      }

      return Promise.resolve(context);
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
      POSTHOG_PROJECT_TOKEN: apiKey,
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
      'This is a Ruby project. Check the additional context lines below for detected patterns and entry points.',
    packageInstallation:
      "Use Bundler if a Gemfile is present (add `gem 'posthog-ruby'` and run `bundle install`). Otherwise use `gem install posthog-ruby`. Do not pin a specific version.",
    getAdditionalContextLines: (context) => {
      const packageManagerName = context.packageManager
        ? getPackageManagerName(context.packageManager)
        : 'unknown';

      const lines: string[] = [];

      lines.push(`Package manager: ${packageManagerName}`);

      if (context.entryPoint) {
        lines.push(`Entry point: ${context.entryPoint}`);
      }

      if (context.detectedPatterns && context.detectedPatterns.length > 0) {
        lines.push(`Detected patterns: ${context.detectedPatterns.join(', ')}`);
      }

      lines.push(
        `Framework docs ID: ruby (use posthog://docs/frameworks/ruby for documentation)`,
      );
      lines.push(``);
      lines.push(
        `Integration approach: Explore the project's file structure to understand its architecture, then integrate posthog-ruby in the way that best fits the project's existing patterns.`,
      );
      lines.push(``);
      lines.push(`## CRITICAL: Ruby PostHog Best Practices`);
      lines.push(``);
      lines.push(`### 1. Gem Name vs Require`);
      lines.push(
        `The gem is named posthog-ruby but you require it as 'posthog':`,
      );
      lines.push(`  gem 'posthog-ruby'  # in Gemfile`);
      lines.push(
        `  require 'posthog'   # in code (NOT require 'posthog-ruby')`,
      );
      lines.push(``);
      lines.push(`### 2. Use Instance-Based API (REQUIRED for scripts/CLIs)`);
      lines.push(
        `Use PostHog::Client.new for scripts and standalone applications:`,
      );
      lines.push(``);
      lines.push(`client = PostHog::Client.new(`);
      lines.push(`  api_key: ENV['POSTHOG_PROJECT_TOKEN'],`);
      lines.push(`  host: ENV['POSTHOG_HOST'] || 'https://us.i.posthog.com'`);
      lines.push(`)`);
      lines.push(``);
      lines.push(`### 3. MUST Call shutdown Before Exit`);
      lines.push(
        `In scripts and CLIs, you MUST call client.shutdown or events will be lost:`,
      );
      lines.push(``);
      lines.push(`begin`);
      lines.push(
        `  client.capture(distinct_id: 'user_123', event: 'my_event')`,
      );
      lines.push(`ensure`);
      lines.push(`  client.shutdown`);
      lines.push(`end`);
      lines.push(``);
      lines.push(`### 4. capture_exception Takes Positional Args`);
      lines.push(
        `client.capture_exception(exception, distinct_id, additional_properties)`,
      );
      lines.push(`Do NOT use keyword arguments for capture_exception.`);
      lines.push(``);
      lines.push(`### 5. NEVER Send PII`);
      lines.push(
        `Do NOT include emails, names, phone numbers, or user content in event properties.`,
      );

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
