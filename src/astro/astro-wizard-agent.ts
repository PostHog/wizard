/* Astro wizard using posthog-agent with PostHog MCP */
import type { WizardOptions } from '../utils/types';
import type { FrameworkConfig } from '../lib/framework-config';
import { detectNodePackageManagers } from '../lib/package-manager-detection';
import { Integration } from '../lib/constants';
import {
  getPackageVersion,
  hasPackageInstalled,
  type PackageDotJson,
} from '../utils/package-json';
import { getPackageDotJson, tryGetPackageJson } from '../utils/clack-utils';
import {
  getAstroRenderingMode,
  getAstroVersionBucket,
  getAstroRenderingModeName,
  AstroRenderingMode,
} from './utils';

type AstroContext = {
  renderingMode?: AstroRenderingMode;
};

export const ASTRO_AGENT_CONFIG: FrameworkConfig<AstroContext> = {
  metadata: {
    name: 'Astro',
    integration: Integration.astro,
    docsUrl: 'https://posthog.com/docs/libraries/astro',
    gatherContext: async (options: WizardOptions) => {
      const renderingMode = await getAstroRenderingMode(options);
      return { renderingMode };
    },
  },

  detection: {
    packageName: 'astro',
    packageDisplayName: 'Astro',
    getVersion: (packageJson: unknown) =>
      getPackageVersion('astro', packageJson as PackageDotJson),
    getVersionBucket: getAstroVersionBucket,
    minimumVersion: '4.0.0',
    getInstalledVersion: async (options: WizardOptions) => {
      const packageJson = await getPackageDotJson(options);
      return getPackageVersion('astro', packageJson);
    },
    detect: async (options) => {
      const packageJson = await tryGetPackageJson(options);
      return packageJson ? hasPackageInstalled('astro', packageJson) : false;
    },
    detectPackageManager: detectNodePackageManagers,
  },

  environment: {
    uploadToHosting: true,
    getEnvVars: (apiKey: string, host: string) => ({
      PUBLIC_POSTHOG_KEY: apiKey,
      PUBLIC_POSTHOG_HOST: host,
    }),
  },

  analytics: {
    getTags: (context) => ({
      'rendering-mode': context.renderingMode ?? 'static',
    }),
  },

  prompts: {
    projectTypeDetection:
      'This is a JavaScript/TypeScript project. Look for package.json and lockfiles (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb) to confirm.',
    getAdditionalContextLines: (context) => {
      const modeName = getAstroRenderingModeName(
        context.renderingMode ?? AstroRenderingMode.STATIC,
      );

      // Map rendering mode to framework ID for MCP docs resource
      const frameworkIdMap: Record<AstroRenderingMode, string> = {
        [AstroRenderingMode.STATIC]: 'astro-static',
        [AstroRenderingMode.VIEW_TRANSITIONS]: 'astro-view-transitions',
        [AstroRenderingMode.SSR]: 'astro-ssr',
        [AstroRenderingMode.HYBRID]: 'astro-hybrid',
      };

      const frameworkId =
        frameworkIdMap[context.renderingMode ?? AstroRenderingMode.STATIC];

      const lines = [
        `Rendering mode: ${modeName}`,
        `Framework docs ID: ${frameworkId} (use posthog://docs/frameworks/${frameworkId} for documentation)`,
      ];

      // Add mode-specific guidance
      if (context.renderingMode === AstroRenderingMode.VIEW_TRANSITIONS) {
        lines.push(
          'IMPORTANT: Use window.__posthog_initialized guard to prevent re-initialization during soft navigation',
        );
        lines.push(
          "IMPORTANT: Set capture_pageview: 'history_change' for automatic pageview tracking",
        );
      }

      if (
        context.renderingMode === AstroRenderingMode.SSR ||
        context.renderingMode === AstroRenderingMode.HYBRID
      ) {
        lines.push(
          'IMPORTANT: Use posthog-node for server-side tracking in API routes',
        );
        lines.push(
          'IMPORTANT: Create a singleton pattern for the posthog-node client',
        );
      }

      return lines;
    },
  },

  ui: {
    successMessage: 'PostHog integration complete',
    estimatedDurationMinutes: 6,
    getOutroChanges: (context) => {
      const modeName = getAstroRenderingModeName(
        context.renderingMode ?? AstroRenderingMode.STATIC,
      );
      const changes = [
        `Analyzed your Astro project structure (${modeName})`,
        `Created PostHog component with is:inline script`,
        `Integrated PostHog into your layout`,
      ];

      if (
        context.renderingMode === AstroRenderingMode.SSR ||
        context.renderingMode === AstroRenderingMode.HYBRID
      ) {
        changes.push(`Set up posthog-node for server-side tracking`);
      }

      if (context.renderingMode === AstroRenderingMode.VIEW_TRANSITIONS) {
        changes.push(
          `Added initialization guard for view transitions compatibility`,
        );
      }

      return changes;
    },
    getOutroNextSteps: () => {
      return [
        'Start your development server to see PostHog in action',
        'Visit your PostHog dashboard to see incoming events',
      ];
    },
  },
};
