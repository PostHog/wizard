/* React Native wizard using posthog-agent with PostHog MCP */
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
  detectReactNativeVariant,
  getReactNativeVariantName,
  getReactNativeVersionBucket,
  ReactNativeVariant,
} from './utils';

type ReactNativeContext = {
  variant?: ReactNativeVariant;
};

export const REACT_NATIVE_AGENT_CONFIG: FrameworkConfig<ReactNativeContext> = {
  metadata: {
    name: 'React Native',
    integration: Integration.reactNative,
    docsUrl: 'https://posthog.com/docs/libraries/react-native',
    gatherContext: async (options: WizardOptions) => {
      const variant = await detectReactNativeVariant(options);
      return { variant };
    },
  },

  detection: {
    packageName: 'react-native',
    packageDisplayName: 'React Native',
    getVersion: (packageJson: unknown) =>
      getPackageVersion('react-native', packageJson as PackageDotJson),
    getVersionBucket: getReactNativeVersionBucket,
    minimumVersion: '0.73.0',
    getInstalledVersion: async (options: WizardOptions) => {
      const packageJson = await getPackageDotJson(options);
      return getPackageVersion('react-native', packageJson);
    },
    detect: async (options) => {
      const packageJson = await tryGetPackageJson(options);
      return packageJson
        ? hasPackageInstalled('react-native', packageJson)
        : false;
    },
    detectPackageManager: detectNodePackageManagers,
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
      variant:
        context.variant === ReactNativeVariant.EXPO ? 'expo' : 'react-native',
    }),
  },

  prompts: {
    projectTypeDetection:
      'This is a React Native project. Look for package.json, android/ and ios/ directories, and lockfiles to confirm. Check for expo in package.json to determine the variant.',
    getAdditionalContextLines: (context) => {
      const isExpo = context.variant === ReactNativeVariant.EXPO;
      const frameworkId = 'react-native';

      const lines = [
        `Framework docs ID: ${frameworkId} (use posthog://docs/frameworks/${frameworkId} for documentation)`,
        `Variant: ${isExpo ? 'Expo' : 'React Native'}`,
      ];

      if (isExpo) {
        lines.push(
          'Use `npx expo install` for package installation.',
          'Use EXPO_PUBLIC_ prefix for environment variables exposed to the client.',
        );
      } else {
        lines.push(
          'This is a React Native project without Expo. Native linking may be required.',
          'For iOS, ensure pods are installed after adding PostHog.',
        );
      }

      return lines;
    },
  },

  ui: {
    successMessage: 'PostHog integration complete',
    estimatedDurationMinutes: 10,
    getOutroChanges: (context) => {
      const variant = context.variant ?? ReactNativeVariant.REACT_NATIVE;
      const variantName = getReactNativeVariantName(variant);
      return [
        `Analyzed your React Native project structure (${variantName})`,
        `Installed and configured the PostHog React Native SDK`,
        `Integrated PostHog into your application`,
      ];
    },
    getOutroNextSteps: (context) => {
      const isExpo = context.variant === ReactNativeVariant.EXPO;
      const steps = [];

      if (!isExpo) {
        steps.push('Run `npx pod-install` to install iOS dependencies');
      }

      steps.push(
        isExpo
          ? 'Start your development server with `npx expo start` to see PostHog in action'
          : 'Start your development server to see PostHog in action',
        'Visit your PostHog dashboard to see incoming events',
      );

      return steps;
    },
  },
};
