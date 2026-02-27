/* Generic Node.js language wizard using posthog-agent with PostHog MCP */
import type { FrameworkConfig } from '../lib/framework-config';
import { Integration } from '../lib/constants';
import { tryGetPackageJson } from '../utils/clack-utils';
import { detectNodePackageManagers } from '../lib/package-manager-detection';
import { hasPackageInstalled } from '../utils/package-json';
import { FRAMEWORK_PACKAGES } from '../javascript-web/utils';
import { hasLockfileOrDeps } from '../utils/js-detection';

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
        if (!packageJson) {
          return false;
        }

        // Exclude projects with known framework packages (handled by
        // their dedicated detectors earlier in the enum)
        for (const frameworkPkg of FRAMEWORK_PACKAGES) {
          if (hasPackageInstalled(frameworkPkg, packageJson)) {
            return false;
          }
        }

        // Catch-all for JS projects without browser signals (those
        // matched javascript_web already). Require a lockfile or real
        // dependencies so we don't match bare tooling package.json files.
        return hasLockfileOrDeps(options.installDir, packageJson);
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
