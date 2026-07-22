/* Flutter wizard using posthog-agent with PostHog MCP */
import type { WizardRunOptions } from '@utils/types';
import type { FrameworkConfig } from '@lib/framework-config';
import { Integration } from '@lib/constants';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pubPackageManager } from '@lib/detection/package-manager';

/** Platform subtrees `flutter create` scaffolds; each needs its own setup notes. */
const FLUTTER_PLATFORM_DIRS = [
  'android',
  'ios',
  'web',
  'macos',
  'linux',
  'windows',
] as const;

type FlutterContext = {
  platforms?: string[];
};

function readPubspec(installDir: string): string | undefined {
  const pubspecPath = path.join(installDir, 'pubspec.yaml');
  if (!fs.existsSync(pubspecPath)) return undefined;
  return fs.readFileSync(pubspecPath, 'utf-8');
}

export const FLUTTER_AGENT_CONFIG: FrameworkConfig<FlutterContext> = {
  metadata: {
    name: 'Flutter',
    integration: Integration.flutter,
    docsUrl: 'https://posthog.com/docs/libraries/flutter',
    gatherContext: (options: WizardRunOptions) => {
      const platforms = FLUTTER_PLATFORM_DIRS.filter((dir) =>
        fs.existsSync(path.join(options.installDir, dir)),
      );
      return Promise.resolve({ platforms });
    },
  },

  detection: {
    packageName: 'posthog_flutter',
    packageDisplayName: 'Flutter',
    usesPackageJson: false,
    getVersion: () => undefined,
    detectPackageManager: pubPackageManager,
    // A pubspec.yaml alone is any Dart project; depending on the Flutter SDK
    // (`sdk: flutter`) is what makes it a Flutter app. Anchored to a key/value
    // line so comments (`# sdk: flutter`) don't match.
    detect: (options) => {
      const pubspec = readPubspec(options.installDir);
      return Promise.resolve(/^\s*sdk:\s*flutter\s*$/m.test(pubspec ?? ''));
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
    getTags: (context) => ({
      ...(context.platforms?.length
        ? { platforms: context.platforms.join(',') }
        : {}),
    }),
  },

  prompts: {
    projectTypeDetection:
      'This is a Flutter project. Look for pubspec.yaml declaring a dependency on the Flutter SDK (flutter: sdk: flutter) and a lib/ directory with Dart source files to confirm.',
    packageInstallation:
      'Add the PostHog Flutter SDK with `flutter pub add posthog_flutter`. Do not edit pubspec.yaml by hand; the pub tool updates it and resolves the version automatically.',
    getAdditionalContextLines: (context) => {
      const lines = [
        'Framework docs ID: flutter (use posthog://docs/frameworks/flutter for documentation)',
        'Prefer manual initialization in Dart (PostHogConfig + Posthog().setup) over the platform auto-init so configuration lives in one place; when doing so, disable auto-init in the Android manifest and iOS Info.plist per the docs.',
      ];

      if (context.platforms?.length) {
        lines.push(
          `Enabled target platforms: ${context.platforms.join(
            ', ',
          )}. Apply the platform-specific setup steps from the docs for each (e.g. AndroidManifest.xml on Android, Info.plist on iOS/macOS, the JS snippet in web/index.html for web).`,
        );
      }

      return lines;
    },
  },

  ui: {
    successMessage: 'PostHog integration complete',
    estimatedDurationMinutes: 5,
    getOutroChanges: () => [
      'Analyzed your Flutter project structure',
      'Added the posthog_flutter SDK to your pubspec',
      'Configured PostHog initialization',
      'Added event capture and user identification',
    ],
    getOutroNextSteps: () => [
      'Run your app to see PostHog in action',
      'Visit your PostHog dashboard to see incoming events',
      'Check out the PostHog Flutter docs for session replay, feature flags, and more',
    ],
  },
};
