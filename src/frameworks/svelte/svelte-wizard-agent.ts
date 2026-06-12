/* SvelteKit wizard using posthog-agent with PostHog MCP */
import type { FrameworkConfig } from '@lib/framework-config';
import { detectNodePackageManagers } from '@lib/detection/package-manager';
import { Integration } from '@lib/constants';
import {
  getDeclaredVersion,
  hasDeclaredDependency,
  type PackageJson,
} from '@utils/package-json';
import { tryGetPackageJson } from '@utils/setup-utils';

type SvelteKitContext = Record<string, unknown>;

export const SVELTEKIT_AGENT_CONFIG: FrameworkConfig<SvelteKitContext> = {
  metadata: {
    name: 'SvelteKit',
    integration: Integration.sveltekit,
    docsUrl: 'https://posthog.com/docs/libraries/svelte',
    additionalMcpServers: {
      svelte: { url: 'https://mcp.svelte.dev/mcp' },
    },
  },

  detection: {
    packageName: '@sveltejs/kit',
    packageDisplayName: 'SvelteKit',
    getVersion: (packageJson: unknown) =>
      getDeclaredVersion('@sveltejs/kit', packageJson as PackageJson),
    detect: async (options) => {
      const packageJson = await tryGetPackageJson(options);
      return packageJson
        ? hasDeclaredDependency('@sveltejs/kit', packageJson)
        : false;
    },
    minimumVersion: '2.0.0',
    detectPackageManager: detectNodePackageManagers,
  },

  environment: {
    uploadToHosting: true,
    getEnvVars: (apiKey: string, host: string) => ({
      PUBLIC_POSTHOG_PROJECT_TOKEN: apiKey,
      PUBLIC_POSTHOG_HOST: host,
    }),
  },

  analytics: {
    getTags: () => ({}),
  },

  prompts: {
    projectTypeDetection:
      'This is a JavaScript/TypeScript project using SvelteKit. Look for package.json, svelte.config.js, and lockfiles (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb) to confirm.',
    getAdditionalContextLines: () => [
      'Framework docs ID: sveltekit (use posthog://docs/frameworks/sveltekit for documentation)',
    ],
  },

  ui: {
    successMessage: 'PostHog integration complete',
    estimatedDurationMinutes: 8,
    getOutroChanges: () => [
      'Analyzed your SvelteKit project structure',
      'Created and configured PostHog initializers',
      'Integrated PostHog into your application',
    ],
    getOutroNextSteps: () => [
      'Start your development server to see PostHog in action',
      'Visit your PostHog dashboard to see incoming events',
    ],
  },
};
