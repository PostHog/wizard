/** The SDK registry: the SDKs `installedSdks` names, each with the package names that show it. */

type SdkMatcher = (packageName: string) => boolean;

const named =
  (...patterns: RegExp[]): SdkMatcher =>
  (packageName) =>
    patterns.some((pattern) => pattern.test(packageName));

/** Every SDK the wizard looks for in a project's manifests, by id. */
export const SDK_REGISTRY: Readonly<Record<string, SdkMatcher>> = {
  posthog: named(/posthog/i),
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
