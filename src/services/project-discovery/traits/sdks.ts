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

export type SdkVersionPin =
  | 'exact'
  | 'major_range'
  | 'wide_range'
  | 'none'
  | 'mixed';

/** Closed-schema, path-free SDK version summary for discovery telemetry. */
export type PosthogSdkSummary = {
  has_existing_sdk: boolean;
  /** Comma-joined sorted unique `<ecosystem>:<lowercased-pkg>@<major>.<minor>` (patch omitted), omitted when none parsed. */
  sdk_version_found?: string;
  /** How the declared SDK version(s) are constrained, omitted when no PostHog SDK is detected. */
  sdk_version_pin?: SdkVersionPin;
  detected_sdk_count: number;
  unversioned_sdk_count: number;
  detected_sdks: string[];
};

const EXPLICIT_EXACT_PIN_SPEC =
  /^(?:==|=)\s?v?\d+(?:\.\d+){1,2}(?:[-+.a-zA-Z0-9]+)?$/;
const BARE_EXACT_PIN_SPEC = /^v?\d+\.\d+\.\d+(?:[-+.a-zA-Z0-9]+)?$/;

function isExactPin(trimmedSpec: string, ecosystem: string): boolean {
  if (trimmedSpec.length > 64) return false;
  if (EXPLICIT_EXACT_PIN_SPEC.test(trimmedSpec)) return true;
  // Cargo treats bare `x.y.z` as a caret requirement (`^x.y.z`), not an exact pin.
  return ecosystem !== 'cargo' && BARE_EXACT_PIN_SPEC.test(trimmedSpec);
}

/** Summarize every PostHog SDK across `manifests` (all ecosystems, including unversioned entries) without paths or raw specs. */
export function summarizePosthogSdks(
  manifests: readonly DiscoveredManifest[],
): PosthogSdkSummary {
  let detectedCount = 0;
  let unversionedCount = 0;
  const detectedSdks = new Set<string>();
  const versions = new Set<string>();
  const pinKinds = new Set<Exclude<SdkVersionPin, 'mixed'>>();

  for (const manifest of manifests) {
    for (const pkg of manifest.packages) {
      const lower = pkg.toLowerCase();
      if (!POSTHOG_SDK_PACKAGES.has(lower)) continue;
      detectedCount += 1;
      const sdkId = `${manifest.ecosystem}:${lower}`;
      detectedSdks.add(sdkId);
      const spec = manifest.versions[pkg] ?? '';
      try {
        const range = declaredRange(spec);
        const floor = range ? declaredFloor(spec) : undefined;
        if (!range || !floor) {
          unversionedCount += 1;
          pinKinds.add('none');
          continue;
        }
        const [majorPart, minorPart = '0'] = floor.split('.');
        const majorNum = Number(majorPart);
        const nextMajor = majorNum + 1;
        if (!Number.isSafeInteger(nextMajor)) {
          throw new RangeError('Major version exceeds safe integer');
        }
        const trimmed = spec.trim();
        const pinKind: Exclude<SdkVersionPin, 'mixed'> = isExactPin(
          trimmed,
          manifest.ecosystem,
        )
          ? 'exact'
          : intersects(range, `>=${nextMajor}.0.0`)
          ? 'wide_range'
          : 'major_range';
        versions.add(`${sdkId}@${majorPart}.${minorPart}`);
        pinKinds.add(pinKind);
      } catch {
        unversionedCount += 1;
        pinKinds.add('none');
      }
    }
  }

  const sdkVersionFound = [...versions].sort().join(',');
  const sdkVersionPin: SdkVersionPin | undefined =
    pinKinds.size === 0
      ? undefined
      : pinKinds.size === 1
      ? [...pinKinds][0]
      : 'mixed';

  return {
    has_existing_sdk: detectedCount > 0,
    ...(sdkVersionFound ? { sdk_version_found: sdkVersionFound } : {}),
    ...(sdkVersionPin ? { sdk_version_pin: sdkVersionPin } : {}),
    detected_sdk_count: detectedCount,
    unversioned_sdk_count: unversionedCount,
    detected_sdks: [...detectedSdks].sort(),
  };
}
