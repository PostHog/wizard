/* Generic JavaScript Web (client-side) wizard using posthog-agent with PostHog MCP */
import type { WizardOptions } from '../../utils/types';
import type { FrameworkConfig } from '../../lib/framework-config';
import { Integration } from '../../lib/constants';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { hasPackageInstalled } from '../../utils/package-json';
import { tryGetPackageJson } from '../../utils/setup-utils';
import {
  FRAMEWORK_PACKAGES,
  detectJsPackageManager,
  detectBundler,
  hasIndexHtml,
  detectVanillaWeb,
  hasSrcDirectory,
  type JavaScriptContext,
} from './utils';
import { detectNodePackageManagers } from '../../lib/detection/package-manager';

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
      const vanillaHtml = detectVanillaWeb(options);
      const hasSrcDir = hasSrcDirectory(options);
      return Promise.resolve({
        packageManagerName,
        hasTypeScript,
        hasBundler,
        isVanilla: !!vanillaHtml,
        htmlEntryPoint: vanillaHtml ?? undefined,
        hasSrcDir,
      });
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

      // Path 1: Vanilla web project (no package.json at all)
      if (!packageJson) {
        const vanillaHtml = detectVanillaWeb(options);
        return !!vanillaHtml;
      }

      // Exclude projects with known framework packages
      for (const frameworkPkg of FRAMEWORK_PACKAGES) {
        if (hasPackageInstalled(frameworkPkg, packageJson)) {
          return false;
        }
      }

      const { installDir } = options;

      // Path 2: Bundled web project (package.json + lockfile + frontend signal)
      const hasIndexHtmlFlag = hasIndexHtml(options);
      const bundler = detectBundler(options);
      const hasBundler = !!bundler;

      const hasLockfile = [
        'package-lock.json',
        'yarn.lock',
        'pnpm-lock.yaml',
        'bun.lockb',
        'bun.lock',
        'deno.lock',
      ].some((lockfile) => fs.existsSync(path.join(installDir, lockfile)));

      if (hasLockfile && (hasIndexHtmlFlag || hasBundler)) {
        return true;
      }

      // Otherwise → Node/Backend (handled by javascriptNode fallback)
      return false;
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
      const tags: Record<string, string> = {
        packageManager: context.packageManagerName ?? 'unknown',
      };
      if (context.hasBundler) {
        tags.bundler = context.hasBundler;
      }
      if (context.isVanilla) {
        tags.projectVariant = 'vanilla';
      }
      return tags;
    },
  },

  prompts: {
    projectTypeDetection:
      'This is a client-side web project. It may use a package manager and bundler, or it may be a vanilla HTML/CSS/JS site — check the additional context lines below.',
    packageInstallation:
      'Check the additional context below for whether a package manager is available. If no package manager is detected, use a CDN script tag for posthog-js instead of npm install.',
    getAdditionalContextLines: (context) => {
      const lines: string[] = [];

      if (context.isVanilla) {
        lines.push(
          `Project type: Vanilla web (no package manager — use CDN script tag for posthog-js)`,
        );
        if (context.htmlEntryPoint) {
          lines.push(`HTML entry point: ${context.htmlEntryPoint}`);
        }
      } else {
        lines.push(
          `Project type: JavaScript/TypeScript web application (no specific framework detected)`,
        );
        lines.push(
          `Package manager: ${context.packageManagerName ?? 'unknown'}`,
        );
        if (context.hasBundler) {
          lines.push(`Bundler: ${context.hasBundler}`);
        }
        lines.push(`Has TypeScript: ${context.hasTypeScript ? 'yes' : 'no'}`);
      }

      if (context.hasSrcDir) {
        lines.push(`Project structure: has src/ directory`);
      }

      lines.push(
        `Framework docs ID: js (use posthog://docs/frameworks/js for documentation if available)`,
      );
      lines.push(``);
      lines.push(
        `Integration approach: No specific framework was detected. Explore the project's file structure to understand its architecture, then integrate posthog-js in the way that best fits the project's existing patterns.`,
      );

      return lines;
    },
  },

  ui: {
    successMessage: 'PostHog integration complete',
    estimatedDurationMinutes: 5,
    getOutroChanges: (context) => {
      if (context.isVanilla) {
        return [
          `Analyzed your vanilla web project structure`,
          `Added posthog-js via script tag`,
          `Created PostHog initialization code`,
          `Configured autocapture, error tracking, and event capture`,
        ];
      }
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
