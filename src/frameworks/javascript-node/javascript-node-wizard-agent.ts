/* Generic Node.js language wizard using posthog-agent with PostHog MCP */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FrameworkConfig } from '@lib/framework-config';
import { Integration } from '@lib/constants';
import { tryGetPackageJson } from '@utils/setup-utils';
import { hasDeclaredDependency } from '@utils/package-json';
import { detectNodePackageManagers } from '@lib/detection/package-manager';

const VITE_CONFIG_FILES = [
  'vite.config.js',
  'vite.config.ts',
  'vite.config.mjs',
  'vite.config.mts',
  'vite.config.cjs',
  'vite.config.cts',
];

type JavaScriptNodeContext = Record<string, unknown>;

export const JAVASCRIPT_NODE_AGENT_CONFIG: FrameworkConfig<JavaScriptNodeContext> =
  {
    metadata: {
      name: 'Node.js',
      integration: Integration.javascriptNode,
      docsUrl: 'https://posthog.com/docs/libraries/node',
    },

    detection: {
      packageName: 'posthog-node',
      packageDisplayName: 'Node.js',
      usesPackageJson: false,
      getVersion: () => undefined,
      detectPackageManager: detectNodePackageManagers,
      detect: async (options) => {
        const packageJson = await tryGetPackageJson(options);
        if (!packageJson) return false;
        // A Vite project is a frontend build, not a server-side Node app.
        // This config sits before `javascript_web` in the detection loop and
        // matches on package.json alone, so without this exclusion it claims
        // every Vite app and integrates posthog-node into a browser project.
        if (hasDeclaredDependency('vite', packageJson)) return false;
        if (
          VITE_CONFIG_FILES.some((file) =>
            fs.existsSync(path.join(options.installDir, file)),
          )
        ) {
          return false;
        }
        return true;
      },
    },

    environment: {
      uploadToHosting: false,
      getEnvVars: (apiKey: string, host: string) => ({
        POSTHOG_PROJECT_TOKEN: apiKey,
        POSTHOG_HOST: host,
      }),
    },

    analytics: {
      getTags: () => ({}),
    },

    prompts: {
      projectTypeDetection:
        'This is a server-side Node.js project. Look for package.json and lockfiles to confirm.',
      packageInstallation:
        'Use npm, yarn, pnpm, or bun based on the existing lockfile (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb). Install posthog-node as a regular dependency.',
      getAdditionalContextLines: () => [
        `Framework docs ID: javascript_node (use posthog://docs/frameworks/javascript_node for documentation)`,
      ],
    },

    ui: {
      successMessage: 'PostHog integration complete',
      estimatedDurationMinutes: 5,
      getOutroChanges: () => [
        `Analyzed your Node.js project structure`,
        `Installed the posthog-node package`,
        `Created PostHog initialization with proper configuration`,
        `Configured graceful shutdown for event flushing`,
        `Added example code for events, feature flags, and error capture`,
      ],
      getOutroNextSteps: () => [
        'Use the PostHog client instance for all tracking calls',
        'Call posthog.shutdown() on application exit to flush pending events',
        'NEVER send PII in event properties (no emails, names, or user content)',
        'Use posthog.capture() for events and posthog.identify() for users',
        'Visit your PostHog dashboard to see incoming events',
      ],
    },
  };
