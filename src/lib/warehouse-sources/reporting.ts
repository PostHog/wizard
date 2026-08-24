/**
 * Consent-gated telemetry for a completed warehouse-source scan.
 *
 * Both the `posthog-integration` and `warehouse-source` programs scan the
 * same project for warehouse sources and want to report what they found —
 * but only once the user has been asked. `resolveScanReporting` is the one
 * place that question gets answered, so a future reporting site can't
 * forget the check and report on an undecided or declined scan.
 */

import { analytics } from '@utils/analytics';
import {
  DiscoveredFeature,
  mayReportScanResults,
  ScanConsent,
  type WizardSession,
} from '@lib/wizard-session';
import { AI_SOURCE_KINDS } from './registry';
import type { DetectedSource } from './types';

function hasAiSdkEvidence(
  session: WizardSession,
  sources: DetectedSource[],
): boolean {
  return (
    sources.some((s) => AI_SOURCE_KINDS.has(s.kind)) ||
    session.discoveredFeatures.includes(DiscoveredFeature.LLM)
  );
}

/**
 * Boolean only, on the org, never the list of kinds or any non-AI tool: a
 * decline must not leak even the shape of what local detection saw.
 */
export function stampAiSdkDetected(
  session: WizardSession,
  sources: DetectedSource[],
): void {
  const organizationId = session.apiUser?.organization?.id;
  if (!organizationId) return;
  if (!hasAiSdkEvidence(session, sources)) return;

  analytics.groupIdentify('organization', organizationId, {
    wizard_ai_sdk_detected: true,
  });
}

/**
 * The one consent check for scan telemetry. Callers pass `sources` because a
 * caller mid-detection may hold a fresher value than `session` does, and own
 * the `warehouseSourcesReported` flag themselves: 'declined' resolves (returns
 * true) without emitting, 'undecided' does not resolve at all.
 */
export function resolveScanReporting(
  session: WizardSession,
  sources: DetectedSource[],
  emit: (sources: DetectedSource[]) => void,
): boolean {
  if (session.warehouseSourcesReported) return false;
  if (session.scanConsent === ScanConsent.Undecided) return false;

  if (mayReportScanResults(session)) {
    stampAiSdkDetected(session, sources);
    emit(sources);
  }

  return true;
}
