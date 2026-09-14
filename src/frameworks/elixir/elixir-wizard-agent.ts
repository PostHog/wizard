/* Elixir wizard using posthog-agent with PostHog MCP */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WizardRunOptions } from '@utils/types';
import type { FrameworkConfig } from '@lib/framework-config';
import { mixPackageManager } from '@lib/detection/package-manager';
import { Integration } from '@lib/constants';

type ElixirContext = {
  phoenix?: boolean;
};

function readMixExs(installDir: string): string | undefined {
  const mixExsPath = path.join(installDir, 'mix.exs');
  if (!fs.existsSync(mixExsPath)) {
    return undefined;
  }
  return fs.readFileSync(mixExsPath, 'utf-8');
}

/** Phoenix apps get the Plug integration; plain Elixir apps don't. */
function isPhoenixProject(installDir: string): boolean {
  const mixExs = readMixExs(installDir);
  return !!mixExs && /\{\s*:phoenix\s*,/.test(mixExs);
}

export const ELIXIR_AGENT_CONFIG: FrameworkConfig<ElixirContext> = {
  metadata: {
    name: 'Elixir',
    integration: Integration.elixir,
    docsUrl: 'https://posthog.com/docs/libraries/elixir',
    gatherContext: (options: WizardRunOptions) => {
      const phoenix = isPhoenixProject(options.installDir);
      return Promise.resolve({ phoenix });
    },
  },

  detection: {
    packageName: 'posthog',
    packageDisplayName: 'Elixir',
    usesPackageJson: false,
    getVersion: () => undefined,
    // A mix.exs defining a project marks a Mix project root; the def project
    // check keeps stray files named mix.exs from claiming the directory.
    detect: (options) => {
      const mixExs = readMixExs(options.installDir);
      return Promise.resolve(!!mixExs && /def\s+project\b/.test(mixExs));
    },
    detectPackageManager: mixPackageManager,
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
      projectType: context.phoenix ? 'phoenix' : 'elixir',
    }),
  },

  prompts: {
    projectTypeDetection:
      'This is an Elixir project. Look for mix.exs, mix.lock, config/, lib/, and application.ex to confirm; Phoenix apps also have endpoint and router modules.',
    packageInstallation:
      'Mix has no single add command. Add `{:posthog, "~> 2.0"}` to the deps list in mix.exs, then run `mix deps.get` to fetch it.',
    getAdditionalContextLines: (context) => {
      const lines = [
        `Framework docs ID: elixir (use posthog://docs/frameworks/elixir for documentation)`,
        'Configure PostHog in application config (api_key, api_host, in_app_otp_apps) reading from environment variables; set test_mode: true in the test environment.',
      ];
      if (context.phoenix) {
        lines.push(
          'This is a Phoenix app — add PostHog.Integrations.Plug before the router so request context is attached to captured events.',
        );
      }
      return lines;
    },
  },

  ui: {
    successMessage: 'PostHog integration complete',
    estimatedDurationMinutes: 5,
    getOutroChanges: (context) => [
      `Analyzed your ${
        context.phoenix ? 'Phoenix' : 'Elixir'
      } project structure`,
      'Added the posthog Hex package to mix.exs and fetched it with mix deps.get',
      'Configured PostHog in application config from environment variables',
      'Instrumented meaningful events with PostHog.capture',
    ],
    getOutroNextSteps: (context) => [
      context.phoenix
        ? 'Start your Phoenix server with `mix phx.server` and trigger the instrumented code paths'
        : 'Run your Elixir application and trigger the instrumented code paths',
      'Visit your PostHog dashboard to see incoming events',
      'Use PostHog.capture/2 to track custom events',
      'Use PostHog.set_context/1 to set a distinct_id once per request or job process',
    ],
  },
};
