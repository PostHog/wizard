/**
 * The one place a codebase scan leaves the machine. Runs only when the user
 * granted sharing (CI and headless runs grant it) and telemetry is on.
 *
 * Called when consent resolves (the intro's Continue) and again after login,
 * because either can happen first. Each part latches, so a run reports once:
 *   - the `warehouse sources detected` event, which needs no login
 *   - the scan POST, which needs the login
 */

import { analytics } from '@utils/analytics';
import { mayReportScanResults } from '@shared/run-state';
import { VERSION } from '@shared/version';
import type { WizardSession } from '../session/wizard-session';
import { workspaceFingerprint } from './fingerprint';
import { getCodebaseScan, type CodebaseScan } from './scan';
import {
  submitCodebaseScan,
  type CodebaseScanPayload,
  type SubmitOptions,
} from './submit';

/** The store surface reporting needs; `SessionStore` provides it. */
export type ScanReportStore = {
  readonly session: WizardSession;
  markWarehouseSourcesReportedIfNeeded(): void;
  setCodebaseScanReported(): void;
};

export function buildScanPayload(
  scan: CodebaseScan,
  projectId: number,
  installDir: string,
): CodebaseScanPayload {
  return {
    session_id: analytics.runId,
    program: scan.program,
    wizard_version: VERSION,
    workspace_fingerprint: workspaceFingerprint(projectId, installDir),
    scanned_at: scan.scannedAt,
    tools: scan.tools.map((tool) => ({
      kind: tool.kind,
      signals: tool.signals,
    })),
  };
}

export async function reportCodebaseScan(
  store: ScanReportStore,
  options: SubmitOptions = {},
): Promise<void> {
  const { session } = store;
  if (session.noTelemetry) return;
  // Synchronous on purpose: callers rely on the event and its tags landing
  // before whatever they capture next.
  store.markWarehouseSourcesReportedIfNeeded();

  if (!mayReportScanResults(session)) return;
  const { credentials } = session;
  if (!credentials) return;

  if (session.codebaseScanReported) return;
  const scan = getCodebaseScan(session);
  // A failed scan found nothing because it could not look. Posting its empty
  // list would read as "every tool was removed".
  if (!scan || scan.failed) return;
  store.setCodebaseScanReported();
  await submitCodebaseScan(
    credentials,
    buildScanPayload(scan, credentials.projectId, session.installDir),
    options,
  );
}
