/* SvelteKit wizard using posthog-agent with PostHog MCP */
import type { FrameworkConfig } from '../lib/framework-config';
import { Integration } from '../lib/constants';
import {
  getPackageVersion,
  hasPackageInstalled,
  type PackageDotJson,
} from '../utils/package-json';
import { tryGetPackageJson } from '../utils/clack-utils';

type SvelteKitContext = Record<string, unknown>;

export const SVELTEKIT_AGENT_CONFIG: FrameworkConfig<SvelteKitContext> = {
  metadata: {
    name: 'SvelteKit',
    integration: Integration.sveltekit,
    docsUrl: 'https://posthog.com/docs/libraries/svelte',
    beta: true,
    additionalMcpServers: {
      svelte: { url: 'https://mcp.svelte.dev/mcp' },
    },
  },

  detection: {
    packageName: '@sveltejs/kit',
    packageDisplayName: 'SvelteKit',
    getVersion: (packageJson: unknown) =>
      getPackageVersion('@sveltejs/kit', packageJson as PackageDotJson),
    detect: async (options) => {
      const packageJson = await tryGetPackageJson(options);
      return packageJson
        ? hasPackageInstalled('@sveltejs/kit', packageJson)
        : false;
    },
  },

  environment: {
    uploadToHosting: true,
    getEnvVars: (apiKey: string, host: string) => ({
      PUBLIC_POSTHOG_KEY: apiKey,
      PUBLIC_POSTHOG_HOST: host,
    }),
  },

  analytics: {
    getTags: () => ({}),
  },

  prompts: {
    projectTypeDetection:
      'This is a JavaScript/TypeScript project using SvelteKit. Look for package.json, svelte.config.js, and lockfiles (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb) to confirm.',
    packageInstallation:
      'Look for lockfiles to determine the package manager (npm, yarn, pnpm, bun). Do not manually edit package.json.',
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
