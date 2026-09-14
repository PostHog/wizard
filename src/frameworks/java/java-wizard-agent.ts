/* Java (server) wizard using posthog-agent with PostHog MCP */
import fg from 'fast-glob';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WizardRunOptions } from '@utils/types';
import type { FrameworkConfig } from '@lib/framework-config';
import { detectJavaPackageManagers } from '@lib/detection/package-manager';
import { Integration } from '@lib/constants';

type JavaContext = {
  buildTool?: 'maven' | 'gradle';
};

const GRADLE_FILES = [
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
];

const ANDROID_GRADLE_MARKERS = [
  'com.android.application',
  'com.android.library',
  'com.android.tools.build:gradle',
];

const KMP_GRADLE_MARKERS = [
  'kotlin("multiplatform")',
  'org.jetbrains.kotlin.multiplatform',
  'kotlin-multiplatform',
];

function readRootGradleFiles(installDir: string): string[] {
  return GRADLE_FILES.map((name) => path.join(installDir, name))
    .filter((p) => fs.existsSync(p))
    .map((p) => fs.readFileSync(p, 'utf-8'));
}

function getBuildTool(installDir: string): 'maven' | 'gradle' | undefined {
  if (fs.existsSync(path.join(installDir, 'pom.xml'))) {
    return 'maven';
  }
  if (readRootGradleFiles(installDir).length > 0) {
    return 'gradle';
  }
  return undefined;
}

export const JAVA_AGENT_CONFIG: FrameworkConfig<JavaContext> = {
  metadata: {
    name: 'Java',
    integration: Integration.java,
    docsUrl: 'https://posthog.com/docs/libraries/java',
    gatherContext: (options: WizardRunOptions) => {
      const buildTool = getBuildTool(options.installDir);
      return Promise.resolve({ buildTool });
    },
  },

  detection: {
    packageName: 'posthog-server',
    packageDisplayName: 'Java',
    usesPackageJson: false,
    getVersion: () => undefined,
    // Maven projects (pom.xml) are unambiguously JVM backends. Gradle
    // projects are only claimed when they are neither Android nor KMP —
    // those detectors are ordered earlier, and this re-check keeps a
    // direct java detect() call from ever claiming their projects.
    detect: async (options) => {
      const { installDir } = options;

      // pubspec.yaml means Flutter — its gradle subtree is not a JVM backend.
      if (fs.existsSync(path.join(installDir, 'pubspec.yaml'))) {
        return false;
      }

      if (fs.existsSync(path.join(installDir, 'pom.xml'))) {
        return true;
      }

      const gradleContents = readRootGradleFiles(installDir);
      if (gradleContents.length === 0) {
        return false;
      }
      const combined = gradleContents.join('\n');
      if (
        [...ANDROID_GRADLE_MARKERS, ...KMP_GRADLE_MARKERS].some((marker) =>
          combined.includes(marker),
        )
      ) {
        return false;
      }

      const manifestFiles = await fg('**/AndroidManifest.xml', {
        cwd: installDir,
        ignore: ['**/build/**', '**/node_modules/**', '**/.gradle/**'],
      });
      return manifestFiles.length === 0;
    },
    detectPackageManager: detectJavaPackageManagers,
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
      buildTool: context.buildTool || 'unknown',
    }),
  },

  prompts: {
    projectTypeDetection:
      'This is a Java server project. Look for pom.xml (Maven) or build.gradle/build.gradle.kts (Gradle), src/main/java/, and the framework in use (Spring Boot, Quarkus, Micronaut, plain servlets) to confirm.',
    packageInstallation:
      'Neither Maven nor Gradle has a single add command. Add the com.posthog:posthog-server dependency (pinned to the latest release on Maven Central) to pom.xml or build.gradle(.kts), matching the existing dependency format, then run `mvn install` or `gradle build` to resolve it.',
    getAdditionalContextLines: (context) => {
      const lines = [
        `Framework docs ID: java (use posthog://docs/frameworks/java for documentation)`,
        'Use the posthog-server SDK (com.posthog:posthog-server) — posthog-android is a different library and must not be used on the server.',
        'Create one PostHog client per process with PostHogConfig.builder(...) and PostHog.with(config); call close() during graceful shutdown, and flush() before returning in serverless handlers.',
      ];
      if (context.buildTool) {
        lines.push(`Build tool: ${context.buildTool}`);
      }
      return lines;
    },
  },

  ui: {
    successMessage: 'PostHog integration complete',
    estimatedDurationMinutes: 5,
    getOutroChanges: (context) => [
      'Analyzed your Java project structure',
      `Added the posthog-server dependency to your ${
        context.buildTool === 'maven' ? 'pom.xml' : 'Gradle build'
      }`,
      'Initialized a shared PostHog client configured from environment variables',
      'Instrumented meaningful server events with posthog.capture',
    ],
    getOutroNextSteps: () => [
      'Run your Java service and trigger the instrumented code paths',
      'Visit your PostHog dashboard to see incoming events',
      'Use posthog.capture(distinctId, eventName, options) to track custom events',
      'Keep posthog.close() in your graceful shutdown path so queued events flush',
    ],
  },
};
