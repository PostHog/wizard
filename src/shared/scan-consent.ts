/** Features discovered by the feature-discovery subagent */
export enum DiscoveredFeature {
  Stripe = 'stripe',
  LLM = 'llm',
}

/** Consent to report what local detection found. */
export enum ScanConsent {
  Undecided = 'undecided',
  Granted = 'granted',
  Declined = 'declined',
}

type ScanConsentState = { scanConsent: string };

/** One place to ask, so a new consent state does not need three edits. */
export function mayReportScanResults(session: ScanConsentState): boolean {
  return session.scanConsent === 'granted';
}

/** Lives here so analytics infrastructure never learns what consent means. */
export function reportableDiscoveredFeatures(
  session: ScanConsentState & { discoveredFeatures: DiscoveredFeature[] },
): DiscoveredFeature[] | undefined {
  return mayReportScanResults(session) ? session.discoveredFeatures : undefined;
}

/** Also a scan result, so it travels under the same consent as the rest. */
export function reportablePosthogSdkDetected(
  session: ScanConsentState & { posthogSdkDetected: boolean },
): boolean | undefined {
  return mayReportScanResults(session) ? session.posthogSdkDetected : undefined;
}
