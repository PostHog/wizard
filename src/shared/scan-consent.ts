/** Features discovered by scanning project dependencies. */
export enum DiscoveredFeature {
  Stripe = 'stripe',
  LLM = 'llm',
}

type ScanConsentState = { scanConsent: string };

/** An undecided or declined scan never reports local detection results. */
export function mayReportScanResults(session: ScanConsentState): boolean {
  return session.scanConsent === 'granted';
}

export function reportableDiscoveredFeatures<TFeature>(
  session: ScanConsentState & { discoveredFeatures: TFeature[] },
): TFeature[] | undefined {
  return mayReportScanResults(session) ? session.discoveredFeatures : undefined;
}

export function reportablePosthogSdkDetected(
  session: ScanConsentState & { posthogSdkDetected: boolean },
): boolean | undefined {
  return mayReportScanResults(session) ? session.posthogSdkDetected : undefined;
}
