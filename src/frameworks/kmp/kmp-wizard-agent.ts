/* Kotlin Multiplatform (KMP) wizard using posthog-agent with PostHog MCP */
import type { FrameworkConfig } from '../../lib/framework-config';
import { Integration } from '../../lib/constants';
import { gradlePackageManager } from '../../lib/detection/package-manager';
import fg from 'fast-glob';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const KMP_AGENT_CONFIG: FrameworkConfig = {
  metadata: {
    name: 'Kotlin Multiplatform',
    integration: Integration.kmp,
    beta: true,
    docsUrl: 'https://posthog.com/docs/libraries/kmp',
    preRunNotice:
      'The PostHog Kotlin Multiplatform SDK is in early access (0.x pre-release). The API may change between minor versions.',
  },

  detection: {
    packageName: 'posthog-kmp',
    packageDisplayName: 'Kotlin Multiplatform',
    usesPackageJson: false,
    getVersion: () => undefined,
    detectPackageManager: gradlePackageManager,
    // KMP is detected before Android/Swift because a KMP project also looks like
    // an Android and/or Swift project. Detection therefore requires the Kotlin
    // Multiplatform Gradle plugin or a `commonMain` source set — signals that a
    // plain Android or Swift project does not have.
    detect: async (options) => {
      const { installDir } = options;

      // Strategy 1: a Gradle build file that applies the Kotlin Multiplatform plugin.
      const buildFiles = await fg(['**/build.gradle', '**/build.gradle.kts'], {
        cwd: installDir,
        ignore: ['**/build/**', '**/node_modules/**', '**/.gradle/**'],
      });

      for (const file of buildFiles) {
        const content = fs.readFileSync(path.join(installDir, file), 'utf-8');
        if (
          content.includes('kotlin("multiplatform")') ||
          content.includes('org.jetbrains.kotlin.multiplatform') ||
          content.includes('kotlin-multiplatform')
        ) {
          return true;
        }
      }

      // Strategy 2: a KMP `commonMain` source set exists.
      const commonMain = await fg('**/src/commonMain', {
        cwd: installDir,
        onlyDirectories: true,
        ignore: ['**/build/**', '**/node_modules/**', '**/.gradle/**'],
      });

      return commonMain.length > 0;
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
    getTags: () => ({}),
  },

  prompts: {
    projectTypeDetection:
      'This is a Kotlin Multiplatform (KMP) project. Look for a build.gradle.kts (or build.gradle) that applies the Kotlin Multiplatform plugin (kotlin("multiplatform") or org.jetbrains.kotlin.multiplatform) and a shared module with a src/commonMain source set.',
    packageInstallation:
      'Add the PostHog KMP SDK to the shared module\'s commonMain dependencies in build.gradle.kts: within the kotlin { sourceSets { ... } } block, add implementation("com.posthog:posthog-kmp:<VERSION>") to commonMain.dependencies. Match the existing dependency format (Groovy vs Kotlin DSL).',
    getAdditionalContextLines: () => [
      'Framework docs ID: kmp (use posthog://docs/frameworks/kmp for documentation)',
      'Initialize once, early in the app lifecycle, from shared code. All PostHog APIs live in the com.posthog.kmp package.',
      'Setup call: PostHog.setup(config = PostHogConfig(apiKey = "<POSTHOG_PROJECT_TOKEN>", host = "<POSTHOG_HOST>"), context = PostHogContext())',
      'PostHogContext is platform-specific: on Android pass the Application via PostHogContext(application); on iOS and Web use the no-argument PostHogContext().',
      'Imports: com.posthog.kmp.PostHog, com.posthog.kmp.PostHogConfig, com.posthog.kmp.PostHogContext.',
    ],
  },

  ui: {
    successMessage: 'PostHog integration complete',
    estimatedDurationMinutes: 5,
    getOutroChanges: () => [
      'Analyzed your Kotlin Multiplatform project structure',
      'Added the PostHog KMP SDK to your shared module',
      'Configured PostHog initialization in your shared code',
      'Added event capture and user identification',
    ],
    getOutroNextSteps: () => [
      'Wire up the platform-specific PostHogContext for each target (Android/iOS/Web)',
      'Build and run your app to see PostHog in action',
      'Visit your PostHog dashboard to see incoming events',
      'Check out the PostHog KMP docs for feature flags, session replay, and more',
    ],
  },
};
