/**
 * The one place a codebase scan is cleared to leave the machine. Runs only
 * when the user granted sharing (CI and headless runs grant it) and telemetry
 * is on.
 *
 * Called when consent resolves (the intro's Continue) and again after login,
 * because either can happen first. Each part latches, so a run reports once:
 *   - the `warehouse sources detected` event, which needs no login
 *   - the scan, which needs the login for its fingerprint. This hands it to
 *     the task stream, which attaches it to the run's wizard session, and
 *     sets the email providers it found on the logged-in person.
 */

import { mayReportScanResults } from '@shared/run-state';
import { VERSION } from '@shared/version';
import { analytics } from '@utils/analytics';
import type { WizardSession } from '../session/wizard-session';
import { emailProviderPersonProperties } from './email-providers';
import { workspaceFingerprint } from './fingerprint';
import { getCodebaseScan, type CodebaseScan } from './scan';
import { applyScanTags } from './tags';
import type { ScanReport } from '../session/task-stream/types';

/** The store surface reporting needs; `SessionStore` provides it. */
export type ScanReportStore = {
  readonly session: WizardSession;
  markWarehouseSourcesReportedIfNeeded(): void;
  shareCodebaseScan(report: ScanReport): void;
};

export function buildScanReport(
  scan: CodebaseScan,
  projectId: number,
): ScanReport {
  return {
    program: scan.program,
    wizard_version: VERSION,
    // The directory the scan walked, which a CI run's install dir may no longer be.
    workspace_fingerprint: workspaceFingerprint(projectId, scan.scannedDir),
    scanned_at: scan.scannedAt,
    complete: scan.complete,
    tools: scan.tools.map((tool) => ({
      kind: tool.kind,
      signals: tool.signals,
    })),
  };
}

export function reportCodebaseScan(store: ScanReportStore): void {
  const { session } = store;
  if (session.noTelemetry) return;
  // Synchronous on purpose: callers rely on the event and its tags landing
  // before whatever they capture next.
  applyScanTags(session);
  store.markWarehouseSourcesReportedIfNeeded();

  if (!mayReportScanResults(session)) return;
  const { credentials } = session;
  if (!credentials) return;

  if (session.codebaseScanReport) return;
  const scan = getCodebaseScan(session);
  // A failed scan found nothing because it could not look. Posting its empty
  // list would read as "every tool was removed".
  if (!scan || scan.failed) return;
  setEmailProvidersOnPerson(scan);
  store.shareCodebaseScan(buildScanReport(scan, credentials.projectId));
}

function setEmailProvidersOnPerson(scan: CodebaseScan): void {
  const emailProviders = emailProviderPersonProperties(scan);
  if (emailProviders) analytics.setPersonProperties(emailProviders);
}
