/** Which PostHog SDK versions have each product the wizard sets up. Read after detection, never by an agent. */

/** The PostHog SDKs whose installed major the wizard detects. */
export type PostHogSdk =
  | 'python'
  | 'node'
  | 'go'
  | 'rust'
  | 'ios'
  | 'android'
  | 'flutter'
  | 'kmp';

/** The package name a person upgrades, per SDK. */
export const SDK_PACKAGES: { readonly [S in PostHogSdk]: string } = {
  python: 'posthog',
  node: 'posthog-node',
  go: 'posthog-go',
  rust: 'posthog-rs',
  ios: 'posthog-ios',
  android: 'posthog-android',
  flutter: 'posthog_flutter',
  kmp: 'posthog-kmp',
};

/**
 * The lowest SDK version each product works on. An SDK a product has no entry
 * for works on every version the wizard supports.
 */
export const SDK_FEATURE_MINIMUMS = {
  errorTracking: { node: '4.5.0', rust: '0.12.0', flutter: '5.7.0' },
  releaseLinking: { python: '7.59.0' },
  mcpAnalytics: { python: '7.62.0', node: '5.0.0', rust: '0.29.0' },
  aiObservability: { node: '5.0.0' },
} as const satisfies Record<string, { readonly [S in PostHogSdk]?: string }>;

export type SdkFeature = keyof typeof SDK_FEATURE_MINIMUMS;

/** The product name a person reads, per feature. */
export const SDK_FEATURE_LABELS: { readonly [F in SdkFeature]: string } = {
  errorTracking: 'Error tracking',
  releaseLinking: 'Release linking',
  mcpAnalytics: 'MCP analytics',
  aiObservability: 'AI Observability',
};
