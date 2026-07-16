/**
 * Warehouse-source program detection step.
 *
 * Thin adapter over `detectWarehouseSources` that writes results into
 * frameworkContext for the intro screen, plus the `[ABORT]` cases the
 * data-warehouse-source-setup skill can emit.
 */

import { existsSync, statSync } from 'fs';
import { analytics } from '@utils/analytics';
import type { WizardSession } from '@lib/wizard-session';
import type { AbortCase } from '@lib/agent/agent-runner';
import { detectWarehouseSources } from '@lib/warehouse-sources/detect';
import type { DetectedSource } from '@lib/warehouse-sources/types';

/** Structured detection errors rendered by the intro screen. */
export type WarehouseDetectError =
  | {
      kind: 'bad-directory';
      path: string;
      reason: 'missing' | 'not-dir' | 'unreadable';
    }
  | { kind: 'no-sources' };

/** frameworkContext key holding the detected sources (set on success). */
export const DETECTED_WAREHOUSE_SOURCES_KEY = 'detectedWarehouseSources';

/**
 * Read the detected sources out of frameworkContext. Single accessor shared by
 * the intro screen and the prompt builder so the key + cast live in one place.
 */
export function getDetectedWarehouseSources(
  session: WizardSession,
): DetectedSource[] {
  return (
    (session.frameworkContext[DETECTED_WAREHOUSE_SOURCES_KEY] as
      | DetectedSource[]
      | undefined) ?? []
  );
}

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
 * Scan `session.installDir` for warehouse-source signals. Writes the detected
 * sources (or a `detectError`) into frameworkContext for the intro screen.
 */
export function detectWarehousePrerequisites(
  session: WizardSession,
  setFrameworkContext: (key: string, value: unknown) => void,
): void {
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

  const sources = detectWarehouseSources(installDir);

  if (sources.length === 0) {
    fail({ kind: 'no-sources' });
    return;
  }

  // Tag every subsequent event (agent started/completed, setup wizard
  // finished, …) with what was detected — without this the analytics can't
  // say which source types a run attempted, only that a run happened.
  analytics.setTag(
    'warehouse_source_kinds',
    sources.map((s) => s.kind).join(','),
  );
  analytics.setTag(
    'warehouse_source_modes',
    sources.map((s) => `${s.kind}:${s.mode}`).join(','),
  );
  analytics.setTag('warehouse_source_count', sources.length);

  setFrameworkContext(DETECTED_WAREHOUSE_SOURCES_KEY, sources);
}
