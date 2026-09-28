/**
 * Consent-gated telemetry for a completed warehouse-source scan.
 *
 * Both the `posthog-integration` and `warehouse-source` programs scan the
 * same project for warehouse sources and want to report what they found —
 * but only once the user has been asked. `resolveScanReporting` is the one
 * place that question gets answered, so a future reporting site can't
 * forget the check and report on an undecided or declined scan.
 */

import {
  mayReportScanResults,
  ScanConsent,
  type WizardSession,
} from '@lib/wizard-session';
import type { DetectedSource } from '@lib/warehouse-sources/types';

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

  if (mayReportScanResults(session)) emit(sources);

  return true;
}
