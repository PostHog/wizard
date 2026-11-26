/** The SDK registry: the SDKs `installedSdks` names, each with the package names that show it. */

import { intersects } from 'semver';
import type { SdkFeature } from '@programs/program-contract';
import { declaredFloor, declaredRange } from '@utils/semver';
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

/** A PostHog SDK package a manifest declares, with its ecosystem, normalized range and lowest allowed version. */
export type DeclaredSdk = {
  ecosystem: string;
  name: string;
  version: string;
  range: string;
};

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
        if (!POSTHOG_SDK_PACKAGES.has(name.toLowerCase())) return [];
        const range = declaredRange(spec);
        const version = range ? declaredFloor(spec) : undefined;
        return range && version
          ? [{ ecosystem: m.ecosystem, name, version, range }]
          : [];
      }),
    );
}

/**
 * The lowest version of each PostHog SDK package that each product works on,
 * keyed by `<ecosystem>:<lowercased package name>`. A package a product names
 * no minimum for works on every version.
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
      'npm:posthog-node': '4.5.0',
      'cargo:posthog-rs': '0.12.0',
      'cargo:posthog': '0.12.0',
      'pub:posthog_flutter': '5.7.0',
    },
  },
  releaseLinking: {
    label: 'Release linking',
    minimums: { 'pypi:posthog': '7.59.0' },
  },
  mcpAnalytics: {
    label: 'MCP analytics',
    minimums: {
      'pypi:posthog': '7.62.0',
      'npm:posthog-node': '5.0.0',
      'cargo:posthog-rs': '0.29.0',
      'cargo:posthog': '0.29.0',
    },
  },
  aiObservability: {
    label: 'AI Observability',
    minimums: { 'npm:posthog-node': '5.0.0' },
  },
};

export type SdkTelemetryMode = 'greenfield' | 'versioned' | 'unversioned_only';

/** Closed-schema, path-free SDK version summary for discovery telemetry. */
export type PosthogSdkSummary = {
  sdk_mode: SdkTelemetryMode;
  detected_sdk_count: number;
  unknown_sdk_count: number;
  /** Comma-joined sorted unique `<ecosystem>:<lowercased-pkg>@<major>` tokens, or empty string. */
  detected_sdk_majors: string;
  has_unversioned_sdk: boolean;
  has_pinned_sdk: boolean;
  has_wide_range_sdk: boolean;
};

const EXACT_PIN_SPEC =
  /^\s*(?:==|=)?\s*v?\d+(?:\.\d+){1,2}(?:[-+.a-zA-Z0-9]+)?\s*$/;

/** Summarize every PostHog SDK across `manifests` (all ecosystems, including unversioned entries) without paths or raw specs. */
export function summarizePosthogSdks(
  manifests: readonly DiscoveredManifest[],
): PosthogSdkSummary {
  let detectedCount = 0;
  let unknownCount = 0;
  let hasPinned = false;
  let hasWideRange = false;
  const majors = new Set<string>();

  for (const manifest of manifests) {
    for (const pkg of manifest.packages) {
      const lower = pkg.toLowerCase();
      if (!POSTHOG_SDK_PACKAGES.has(lower)) continue;
      detectedCount += 1;
      const spec = manifest.versions[pkg] ?? '';
      const range = declaredRange(spec);
      const floor = range ? declaredFloor(spec) : undefined;
      if (!range || !floor) {
        unknownCount += 1;
        continue;
      }
      const majorNum = Number(floor.split('.')[0]);
      majors.add(`${manifest.ecosystem}:${lower}@${majorNum}`);
      if (EXACT_PIN_SPEC.test(spec)) {
        hasPinned = true;
      } else if (intersects(range, `>=${majorNum + 1}.0.0`)) {
        hasWideRange = true;
      }
    }
  }

  const sdkMode: SdkTelemetryMode =
    detectedCount === 0
      ? 'greenfield'
      : majors.size > 0
      ? 'versioned'
      : 'unversioned_only';

  return {
    sdk_mode: sdkMode,
    detected_sdk_count: detectedCount,
    unknown_sdk_count: unknownCount,
    detected_sdk_majors: [...majors].sort().join(','),
    has_unversioned_sdk: unknownCount > 0,
    has_pinned_sdk: hasPinned,
    has_wide_range_sdk: hasWideRange,
  };
}
