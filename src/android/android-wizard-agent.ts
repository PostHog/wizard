/* Android (Kotlin) wizard using posthog-agent with PostHog MCP */
import type { WizardOptions } from '../utils/types';
import type { FrameworkConfig } from '../lib/framework-config';
import { Integration } from '../lib/constants';
import fg from 'fast-glob';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  getKotlinVersion,
  getKotlinVersionBucket,
  getMinSdkVersion,
} from './utils';
import { gradlePackageManager } from '../lib/package-manager-detection';

type AndroidContext = {
  kotlinVersion?: string;
};

export const ANDROID_AGENT_CONFIG: FrameworkConfig<AndroidContext> = {
  metadata: {
    name: 'Android (Kotlin)',
    integration: Integration.android,
    beta: true,
    docsUrl: 'https://posthog.com/docs/libraries/android',
    gatherContext: (options: WizardOptions) => {
      const kotlinVersion = getKotlinVersion(options);
      return Promise.resolve({ kotlinVersion });
    },
  },

  detection: {
    packageName: 'posthog-android',
    packageDisplayName: 'Android (Kotlin)',
    usesPackageJson: false,
    getVersion: () => undefined,
    getVersionBucket: (version: string) => getKotlinVersionBucket(version),
    // This is actually pretty high for a minimum, but android apis aren't super stable.
    minimumVersion: '21.0.0',
    getInstalledVersion: (options: WizardOptions) => getMinSdkVersion(options),
    detectPackageManager: gradlePackageManager,
    detect: async (options) => {
      const { installDir } = options;

      // Strategy 1: Check for build.gradle(.kts) with Android plugin
      for (const name of ['build.gradle', 'build.gradle.kts']) {
        const buildGradlePath = path.join(installDir, name);
        if (fs.existsSync(buildGradlePath)) {
          const content = fs.readFileSync(buildGradlePath, 'utf-8');
          if (
            content.includes('com.android.application') ||
            content.includes('com.android.library') ||
            content.includes('com.android.tools.build:gradle')
          ) {
            return true;
          }
        }
      }

      // Strategy 2: Check for AndroidManifest.xml with Kotlin source files
      // This could be an issue if we have Flutter in the mix, but we'll figure that out later.
      const manifestFiles = await fg('**/AndroidManifest.xml', {
        cwd: installDir,
        ignore: ['**/build/**', '**/node_modules/**', '**/.gradle/**'],
      });

      if (manifestFiles.length > 0) {
        const kotlinFiles = await fg('**/*.kt', {
          cwd: installDir,
          ignore: ['**/build/**', '**/node_modules/**', '**/.gradle/**'],
        });
        if (kotlinFiles.length > 0) {
          return true;
        }
      }

      return false;
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
    getTags: (context) => ({
      ...(context.kotlinVersion
        ? { kotlinVersion: getKotlinVersionBucket(context.kotlinVersion) }
        : {}),
    }),
  },

  prompts: {
    projectTypeDetection:
      'This is an Android/Kotlin project. Look for build.gradle or build.gradle.kts files, AndroidManifest.xml, and Kotlin source files (.kt) to confirm.',
    packageInstallation:
      'Add the PostHog Android SDK dependency to the app-level build.gradle(.kts) file. Use implementation("com.posthog:posthog-android:<VERSION>"). Check the existing dependency format (Groovy vs Kotlin DSL) and match it.',
    getAdditionalContextLines: (context) => {
      const lines = [
        `Framework docs ID: android (use posthog://docs/frameworks/android for documentation)`,
      ];

      if (context.kotlinVersion) {
        lines.push(`Kotlin version: ${context.kotlinVersion}`);
      }

      return lines;
    },
  },

  ui: {
    successMessage: 'PostHog integration complete',
    estimatedDurationMinutes: 5,
    getOutroChanges: () => [
      `Analyzed your Android project structure`,
      `Added the PostHog Android SDK dependency`,
      `Configured PostHog initialization in your Application class`,
      `Added event capture and user identification`,
    ],
    getOutroNextSteps: () => [
      'Build and run your app to see PostHog in action',
      'Visit your PostHog dashboard to see incoming events',
      'Check out the PostHog Android docs for advanced features like feature flags and session replay',
    ],
  },
};
