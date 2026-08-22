export const DEFAULT_HEADLINE = "Let's do two hours of work in eight minutes.";
export const DETECTED_HEADLINE =
  'Looks like you already have PostHog installed.';

export function introHeadline(posthogSdkDetected: boolean): string {
  return posthogSdkDetected ? DETECTED_HEADLINE : DEFAULT_HEADLINE;
}
