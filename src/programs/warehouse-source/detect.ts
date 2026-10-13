/**
 * Warehouse-source program detection step.
 *
 * Reads the run's codebase scan and writes a `detectError` into
 * frameworkContext for the intro screen, plus the `[ABORT]` cases the
 * data-warehouse-source-setup skill can emit.
 */

import { existsSync, statSync } from 'fs';
import { analytics } from '@utils/analytics';
import type { ProgramSession } from '../program-session';
import type { AbortCase } from '@agent/types';
import { scannedWarehouseSources } from '../codebase-scan/scan';
import { tagScanResults } from '../codebase-scan/tags';
import { DETECTED_WAREHOUSE_SOURCES_KEY } from '../warehouse-sources/detect';

/** Structured detection errors rendered by the intro screen. */
export type WarehouseDetectError =
  | {
      kind: 'bad-directory';
      path: string;
      reason: 'missing' | 'not-dir' | 'unreadable';
    }
  | { kind: 'no-sources' };

/** `[ABORT] <reason>` cases the skill can emit. */
export const WAREHOUSE_ABORT_CASES: AbortCase[] = [
  {
    // Skill emits: [ABORT] No data source detected
    // Tolerant of plural ("sources") and a trailing period.
    match: /^no data sources? detected\.?$/i,
    message: 'No data source detected',
    body:
      'The agent could not confirm a data warehouse source to connect. ' +
      'Run this command from a project that uses a supported source ' +
      '(a database, Stripe, etc.).',
    docsUrl: 'https://posthog.com/docs/data-warehouse',
  },
  {
    // Skill emits: [ABORT] Source creation failed
    match: /^source creation failed\.?$/i,
    message: 'Source creation failed',
    body:
      'PostHog could not create the data warehouse source with the ' +
      'credentials provided. Double-check the connection details and try ' +
      'again, or set the source up directly in the PostHog app.',
    docsUrl: 'https://posthog.com/docs/data-warehouse',
  },
];

/**
 * Check the run's codebase scan for warehouse sources. Writes a `detectError`
 * into frameworkContext for the intro screen when there is nothing to set up.
 */
export async function detectWarehousePrerequisites(
  session: ProgramSession,
  setFrameworkContext: (key: string, value: unknown) => void,
): Promise<void> {
  const fail = (error: WarehouseDetectError) =>
    setFrameworkContext('detectError', error);

  const installDir = session.installDir;

  if (!existsSync(installDir)) {
    fail({ kind: 'bad-directory', path: installDir, reason: 'missing' });
    return;
  }
  try {
    if (!statSync(installDir).isDirectory()) {
      fail({ kind: 'bad-directory', path: installDir, reason: 'not-dir' });
      return;
    }
  } catch (error) {
    analytics.captureException(
      error instanceof Error ? error : new Error(String(error)),
      { step: 'detectWarehousePrerequisites.stat', path: installDir },
    );
    fail({ kind: 'bad-directory', path: installDir, reason: 'unreadable' });
    return;
  }

  const sources = await scannedWarehouseSources(session);

  if (sources.length === 0) {
    fail({ kind: 'no-sources' });
    return;
  }

  // Tag every subsequent event (agent started/completed, setup wizard
  // finished, …) with what was detected — without this the analytics can't
  // say which source types a run attempted, only that a run happened.
  tagScanResults(session, setFrameworkContext, {
    warehouse_source_kinds: sources.map((s) => s.kind).join(','),
    warehouse_source_modes: sources.map((s) => `${s.kind}:${s.mode}`).join(','),
    warehouse_source_count: sources.length,
  });

  setFrameworkContext(DETECTED_WAREHOUSE_SOURCES_KEY, sources);
}
