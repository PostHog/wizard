/** The SDK registry: the SDKs `installedSdks` names, each with the package names that show it. */

import type { SdkFeature } from '@programs/program-contract';
import { declaredFloor } from '@utils/semver';
import { POSTHOG_SDKS } from '../../detection/package-scanning';
import type { DiscoveredManifest } from '../walk';

type SdkMatcher = (packageName: string) => boolean;

const named =
  (...patterns: RegExp[]): SdkMatcher =>
  (packageName) =>
    patterns.some((pattern) => pattern.test(packageName));

/**
 * PostHog's runtime SDKs, by the names the manifest parsers give, lowercased.
 * An exact list: its CLI, its wizard and its build and lint plugins also hold
 * `posthog` in their names and are no SDK.
 */
const POSTHOG_SDK_PACKAGES: ReadonlySet<string> = new Set([
  ...POSTHOG_SDKS,
  'posthog-js-lite',
  '@posthog/react',
  '@posthog/nuxt',
  '@posthog/ai',
  // PyPI, Hex and CocoaPods.
  'posthog',
  'posthoganalytics',
  'posthog-ruby',
  'posthog-rails',
  'posthog/posthog-php',
  'github.com/posthog/posthog-go',
  'posthog-rs',
  'com.posthog:posthog',
  'com.posthog:posthog-android',
  'com.posthog:posthog-kmp',
  'com.posthog:posthog-server',
  'github.com/posthog/posthog-ios',
  'posthog_flutter',
]);

/** Every SDK the wizard looks for in a project's manifests, by id. */
const SDK_REGISTRY: Readonly<Record<string, SdkMatcher>> = {
  posthog: (packageName) => POSTHOG_SDK_PACKAGES.has(packageName.toLowerCase()),
  stripe: named(/(^|[/@:_-])stripe([/_-]|$)/i),
  amplitude: named(/amplitude/i),
  mixpanel: named(/mixpanel/i),
  segment: named(/(^|[/@])segment([/_-]|$)/i, /^analytics-(node|python)$/i),
  statsig: named(/statsig/i),
};

/** The id of PostHog's own SDKs in {@link SDK_REGISTRY}. */
export const POSTHOG_SDK = 'posthog';

/** The registry SDKs among a manifest's package names, in registry order. */
export function sdksIn(packages: readonly string[]): string[] {
  return Object.entries(SDK_REGISTRY)
    .filter(([, matches]) => packages.some(matches))
    .map(([id]) => id);
}

/** A PostHog SDK package a manifest declares, with the lowest version it allows. */
export type DeclaredSdk = { name: string; version: string };

/** The ecosystems whose PostHog SDK versions pick a skill. Hex is left out: its `posthog` is not PyPI's. */
const VERSIONED_ECOSYSTEMS = new Set([
  'npm',
  'pypi',
  'go',
  'cargo',
  'cocoapods',
  'swiftpm',
  'maven',
  'pub',
]);

/** The PostHog SDKs among `manifests` that declare a version, with the lowest version each allows. */
export function posthogSdkVersions(
  manifests: readonly DiscoveredManifest[],
): DeclaredSdk[] {
  return manifests
    .filter((m) => VERSIONED_ECOSYSTEMS.has(m.ecosystem))
    .flatMap((m) =>
      Object.entries(m.versions).flatMap(([name, spec]) => {
        const version = POSTHOG_SDK_PACKAGES.has(name.toLowerCase())
          ? declaredFloor(spec)
          : undefined;
        return version ? [{ name, version }] : [];
      }),
    );
}

/**
 * The lowest version of each PostHog SDK package that each product works on,
 * by package name. A package a product names no minimum for works on every
 * version.
 */
export const SDK_FEATURE_MINIMUMS: {
  readonly [F in SdkFeature]: {
    label: string;
    minimums: Readonly<Record<string, string>>;
  };
} = {
  errorTracking: {
    label: 'Error tracking',
    minimums: {
      'posthog-node': '4.5.0',
      'posthog-rs': '0.12.0',
      posthog_flutter: '5.7.0',
    },
  },
  releaseLinking: {
    label: 'Release linking',
    minimums: { posthog: '7.59.0' },
  },
  mcpAnalytics: {
    label: 'MCP analytics',
    minimums: {
      posthog: '7.62.0',
      'posthog-node': '5.0.0',
      'posthog-rs': '0.29.0',
    },
  },
  aiObservability: {
    label: 'AI Observability',
    minimums: { 'posthog-node': '5.0.0' },
  },
};
