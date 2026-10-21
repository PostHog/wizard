/**
 * Analytics tags a program derives from the codebase scan. They are scan
 * results, so they leave the machine under the same consent as the scan
 * report. Local suggestions read the scan itself and never wait on this.
 */

import { mayReportScanResults } from '@shared/run-state';
import { analytics } from '@utils/analytics';
import type { ProgramSession } from '../program-session';

/** frameworkContext key holding the tags, kept until sharing is granted. */
export const SCAN_TAGS_KEY = 'codebaseScanTags';

export type ScanTags = Record<string, string | number>;

/** Scan results may leave the machine: sharing is granted and telemetry is on. */
export function maySendScanResults(
  session: Pick<ProgramSession, 'noTelemetry' | 'scanConsent'>,
): boolean {
  return !session.noTelemetry && mayReportScanResults(session);
}

function getScanTags(session: ProgramSession): ScanTags {
  return (
    (session.frameworkContext[SCAN_TAGS_KEY] as ScanTags | undefined) ?? {}
  );
}

function setTags(tags: ScanTags): void {
  for (const [key, value] of Object.entries(tags)) {
    analytics.setTag(key, value);
  }
}

/**
 * Tag later analytics events with what the scan found. A CI or headless run
 * starts with sharing granted, so the tags apply at once. An interactive run
 * keeps them until `reportCodebaseScan` sees the user grant sharing.
 */
export function tagScanResults(
  session: ProgramSession,
  setFrameworkContext: (key: string, value: unknown) => void,
  tags: ScanTags,
): void {
  const merged = { ...getScanTags(session), ...tags };
  setFrameworkContext(SCAN_TAGS_KEY, merged);
  if (maySendScanResults(session)) setTags(merged);
}

/** Apply the kept tags once sharing is granted. Setting a tag twice is harmless. */
export function applyScanTags(session: ProgramSession): void {
  if (maySendScanResults(session)) setTags(getScanTags(session));
}
