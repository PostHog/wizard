/* Generic JavaScript Web (client-side) wizard using posthog-agent with PostHog MCP */
import type { WizardOptions } from '../utils/types';
import type { FrameworkConfig } from '../lib/framework-config';
import { Integration } from '../lib/constants';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { hasPackageInstalled } from '../utils/package-json';
import { tryGetPackageJson } from '../utils/clack-utils';
import {
  FRAMEWORK_PACKAGES,
  detectJsPackageManager,
  detectBundler,
  type JavaScriptContext,
} from './utils';
import { detectNodePackageManagers } from '../lib/package-manager-detection';

export const JAVASCRIPT_WEB_AGENT_CONFIG: FrameworkConfig<JavaScriptContext> = {
  metadata: {
    name: 'JavaScript (Web)',
    integration: Integration.javascript_web,
    beta: true,
    docsUrl: 'https://posthog.com/docs/libraries/js',
    gatherContext: (options: WizardOptions) => {
      const packageManagerName = detectJsPackageManager(options);
      const hasTypeScript = fs.existsSync(
        path.join(options.installDir, 'tsconfig.json'),
      );
      const hasBundler = detectBundler(options);
      return Promise.resolve({ packageManagerName, hasTypeScript, hasBundler });
    },
  },

  detection: {
    packageName: 'posthog-js',
    packageDisplayName: 'JavaScript (Web)',
    usesPackageJson: false,
    getVersion: () => undefined,
    detectPackageManager: detectNodePackageManagers,
    detect: async (options) => {
      const packageJson = await tryGetPackageJson(options);
      if (!packageJson) {
        return false;
      }

      // Exclude projects with known framework packages
      for (const frameworkPkg of FRAMEWORK_PACKAGES) {
        if (hasPackageInstalled(frameworkPkg, packageJson)) {
          return false;
        }
      }

      // Require a positive browser signal — without one, the project is
      // more likely a Node.js server/CLI/worker and should fall through
      // to the javascript_node catch-all (posthog-node is the safer
      // default since posthog-js crashes without window/document).
      //
      // Bundlers alone are NOT a reliable browser signal — Vite/esbuild
      // are commonly used for server-side builds (Cloudflare Workers, SSR,
      // Vitest, etc.). Instead we check for:
      //  1. An HTML entry point (fundamental to browser apps)
      //  2. A "browser" field in package.json (standard npm browser flag)
      const hasHtmlEntry = [
        'index.html',
        'public/index.html',
        'src/index.html',
      ].some((f) => fs.existsSync(path.join(options.installDir, f)));

      const hasBrowserField = 'browser' in packageJson;

      return hasHtmlEntry || hasBrowserField;
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
    getTags: (context) => {
      const tags: Record<string, string> = {
        packageManager: context.packageManagerName ?? 'unknown',
      };
      if (context.hasBundler) {
        tags.bundler = context.hasBundler;
      }
      return tags;
    },
  },

  prompts: {
    projectTypeDetection:
      'This is a JavaScript/TypeScript project. Look for package.json and lockfiles (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb) to confirm.',
    packageInstallation:
      'Look for lockfiles to determine the package manager (npm, yarn, pnpm, bun). Do not manually edit package.json.',
    getAdditionalContextLines: (context) => {
      const lines = [
        `Package manager: ${context.packageManagerName ?? 'unknown'}`,
        `Has TypeScript: ${context.hasTypeScript ? 'yes' : 'no'}`,
        `Framework docs ID: js (use posthog://docs/frameworks/js for documentation if available)`,
        `Project type: Generic JavaScript/TypeScript application (no specific framework detected)`,
      ];

      if (context.hasBundler) {
        lines.unshift(`Bundler: ${context.hasBundler}`);
      }

      return lines;
    },
  },

  ui: {
    successMessage: 'PostHog integration complete',
    estimatedDurationMinutes: 5,
    getOutroChanges: (context) => {
      const packageManagerName =
        context.packageManagerName ?? 'package manager';
      return [
        `Analyzed your JavaScript project structure`,
        `Installed the posthog-js package using ${packageManagerName}`,
        `Created PostHog initialization code`,
        `Configured autocapture, error tracking, and event capture`,
      ];
    },
    getOutroNextSteps: () => [
      'Ensure posthog.init() is called before any capture calls',
      'Autocapture tracks clicks, form submissions, and pageviews automatically',
      'Use posthog.capture() for custom events and posthog.identify() for users',
      'NEVER send PII in event properties (no emails, names, or user content)',
      'Visit your PostHog dashboard to see incoming events',
    ],
  },
};
