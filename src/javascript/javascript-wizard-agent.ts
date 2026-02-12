/* Generic JavaScript language wizard using posthog-agent with PostHog MCP */
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

export const JAVASCRIPT_AGENT_CONFIG: FrameworkConfig<JavaScriptContext> = {
  metadata: {
    name: 'JavaScript',
    integration: Integration.javascript,
    beta: true,
    docsUrl: 'https://posthog.com/docs/libraries/js',
    gatherContext: async (options: WizardOptions) => {
      const packageManagerName = detectJsPackageManager(options);
      const hasTypeScript = fs.existsSync(
        path.join(options.installDir, 'tsconfig.json'),
      );
      const hasBundler = detectBundler(options);
      return { packageManagerName, hasTypeScript, hasBundler };
    },
  },

  detection: {
    packageName: 'posthog-js',
    packageDisplayName: 'JavaScript',
    usesPackageJson: false,
    getVersion: () => undefined,
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

      // Ensure this is actually a JS project, not just a package.json for tooling
      const { installDir } = options;

      // Check for a lockfile
      const hasLockfile = [
        'package-lock.json',
        'yarn.lock',
        'pnpm-lock.yaml',
        'bun.lockb',
        'bun.lock',
      ].some((lockfile) => fs.existsSync(path.join(installDir, lockfile)));

      if (hasLockfile) {
        return true;
      }

      // Fallback: check if package.json has actual dependencies
      const hasDeps =
        (packageJson.dependencies &&
          Object.keys(packageJson.dependencies).length > 0) ||
        (packageJson.devDependencies &&
          Object.keys(packageJson.devDependencies).length > 0);

      return !!hasDeps;
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
        ``,
        `## CRITICAL: posthog-js Best Practices`,
        ``,
        `### 1. Use posthog-js (Browser SDK)`,
        `This is a browser-side JavaScript project. Use the posthog-js package, NOT posthog-node.`,
        `posthog-js is designed for client-side use and includes autocapture, session recording, and feature flags.`,
        ``,
        `### 2. Initialization (REQUIRED)`,
        `posthog.init() MUST be called before any other PostHog methods:`,
        ``,
        `import posthog from 'posthog-js'`,
        ``,
        `posthog.init('<api_key>', {`,
        `  api_host: '<host>',`,
        `})`,
        ``,
        `### 3. Autocapture`,
        `Autocapture is ON by default with posthog-js. It tracks clicks, form submissions, and pageviews automatically.`,
        `Do NOT disable autocapture unless the user explicitly requests it.`,
        ``,
        `### 4. Error Tracking`,
        `Use posthog.captureException(error) for error tracking.`,
        ``,
        `### 5. NEVER Send PII (Personally Identifiable Information)`,
        `DO NOT include in event properties:`,
        `- Email addresses`,
        `- Full names`,
        `- Phone numbers`,
        `- Physical addresses`,
        `- IP addresses`,
        `- Any user-generated content (messages, comments, form submissions)`,
        ``,
        `SAFE event properties:`,
        `posthog.capture('form_submitted', {`,
        `  form_type: 'contact',`,
        `  field_count: 5,`,
        `  has_attachment: true`,
        `})`,
        ``,
        `UNSAFE (DO NOT DO THIS):`,
        `posthog.capture('form_submitted', {`,
        `  email: userEmail,  // NEVER send actual email`,
        `  message: messageContent,  // NEVER send user content`,
        `})`,
        ``,
        `### 6. SPA Pageview Tracking`,
        `For single-page applications without a framework router, you may need to manually capture pageviews:`,
        `posthog.capture('$pageview')`,
        `Or use capture_pageview: 'history_change' in the init options for History API based routing.`,
        ``,
        `### 7. User Identification`,
        `Use posthog.identify('distinct_id') to link events to a user after login.`,
        `Call posthog.reset() on logout to unlink future events from the current user.`,
        ``,
        `IMPORTANT: These best practices are MANDATORY. The implementation will fail review if they are not followed.`,
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
