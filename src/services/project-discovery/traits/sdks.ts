/** The SDK registry: the SDKs `installedSdks` names, each with the package names that show it. */

import { POSTHOG_SDKS } from '../../detection/package-scanning';

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
