/* Generic Node.js language wizard using posthog-agent with PostHog MCP */
import type { FrameworkConfig } from '../../lib/framework-config';
import { Integration } from '../../lib/constants';
import { tryGetPackageJson } from '../../utils/setup-utils';
import { detectNodePackageManagers } from '../../lib/package-manager-detection';

type JavaScriptNodeContext = Record<string, unknown>;

export const JAVASCRIPT_NODE_AGENT_CONFIG: FrameworkConfig<JavaScriptNodeContext> =
  {
    metadata: {
      name: 'Node.js',
      integration: Integration.javascriptNode,
      beta: true,
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
        return !!packageJson;
      },
    },

    environment: {
      uploadToHosting: false,
      getEnvVars: (apiKey: string, host: string) => ({
        POSTHOG_API_KEY: apiKey,
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
