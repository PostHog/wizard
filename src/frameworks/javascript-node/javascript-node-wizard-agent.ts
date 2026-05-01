/* Generic Node.js language wizard using posthog-agent with PostHog MCP */
import type { WizardOptions } from '../../utils/types';
import type { FrameworkConfig } from '../../lib/framework-config';
import { Integration } from '../../lib/constants';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tryGetPackageJson } from '../../utils/setup-utils';
import { detectNodePackageManagers } from '../../lib/detection/package-manager';
import { detectAllPackageManagers } from '../../utils/package-manager';
import {
  detectServerFramework,
  detectEntryPoint,
  detectProjectType,
} from './utils';

type JavaScriptNodeContext = {
  serverFramework?: string;
  entryPoint?: string;
  hasTypeScript?: boolean;
  packageManagerName?: string;
  projectType?: string;
};

export const JAVASCRIPT_NODE_AGENT_CONFIG: FrameworkConfig<JavaScriptNodeContext> =
  {
    metadata: {
      name: 'Node.js',
      integration: Integration.javascriptNode,
      beta: true,
      docsUrl: 'https://posthog.com/docs/libraries/node',
      gatherContext: (options: WizardOptions) => {
        const { installDir } = options;
        const context: JavaScriptNodeContext = {};

        const detected = detectAllPackageManagers(options);
        if (detected.length > 0) {
          context.packageManagerName = detected[0].label;
        }

        context.hasTypeScript = fs.existsSync(
          path.join(installDir, 'tsconfig.json'),
        );

        try {
          const content = fs.readFileSync(
            path.join(installDir, 'package.json'),
            'utf-8',
          );
          const pkg = JSON.parse(content) as Record<string, unknown>;
          context.serverFramework = detectServerFramework(pkg);
          context.entryPoint = detectEntryPoint(installDir, pkg);
          context.projectType = detectProjectType(pkg);
        } catch {
          // No package.json or parse error
        }

        return Promise.resolve(context);
      },
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
        POSTHOG_PROJECT_TOKEN: apiKey,
        POSTHOG_HOST: host,
      }),
    },

    analytics: {
      getTags: (context) => {
        const tags: Record<string, string> = {};
        if (context.serverFramework) {
          tags.serverFramework = context.serverFramework;
        }
        if (context.projectType) {
          tags.projectType = context.projectType;
        }
        return tags;
      },
    },

    prompts: {
      projectTypeDetection:
        'This is a server-side Node.js project. Check the additional context lines below for detected patterns.',
      packageInstallation:
        'Use npm, yarn, pnpm, or bun based on the existing lockfile (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb). Install posthog-node as a regular dependency.',
      getAdditionalContextLines: (context) => {
        const lines: string[] = [];

        if (context.serverFramework) {
          lines.push(
            `Server framework: ${context.serverFramework} (detected in package.json)`,
          );
        }

        if (context.entryPoint) {
          lines.push(`Entry point: ${context.entryPoint}`);
        }

        if (context.projectType) {
          lines.push(`Project type: ${context.projectType}`);
        } else {
          lines.push(
            `Project type: Node.js application (no specific framework detected)`,
          );
        }

        lines.push(
          `Package manager: ${context.packageManagerName ?? 'unknown'}`,
        );
        lines.push(`Has TypeScript: ${context.hasTypeScript ? 'yes' : 'no'}`);
        lines.push(
          `Framework docs ID: javascript_node (use posthog://docs/frameworks/javascript_node for documentation)`,
        );
        lines.push(``);
        lines.push(
          `Integration approach: Explore the project's file structure to understand its architecture, then integrate posthog-node in the way that best fits the project's existing patterns. If a server framework was detected above, look at how it handles middleware, routes, and error handling to find the right integration points.`,
        );

        return lines;
      },
    },

    ui: {
      successMessage: 'PostHog integration complete',
      estimatedDurationMinutes: 5,
      getOutroChanges: (context) => {
        const changes = [`Analyzed your Node.js project structure`];
        if (context.serverFramework) {
          changes.push(
            `Detected ${context.serverFramework} and integrated PostHog accordingly`,
          );
        }
        changes.push(
          `Installed the posthog-node package`,
          `Created PostHog initialization with proper configuration`,
          `Configured graceful shutdown for event flushing`,
        );
        return changes;
      },
      getOutroNextSteps: () => [
        'Use the PostHog client instance for all tracking calls',
        'Call posthog.shutdown() on application exit to flush pending events',
        'NEVER send PII in event properties (no emails, names, or user content)',
        'Use posthog.capture() for events and posthog.identify() for users',
        'Visit your PostHog dashboard to see incoming events',
      ],
    },
  };
