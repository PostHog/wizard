/**
 * Warehouse-source program detection step.
 *
 * Thin adapter over `detectWarehouseSources` that writes results into
 * frameworkContext for the intro screen, plus the `[ABORT]` cases the
 * data-warehouse-source-setup skill can emit.
 */

import { existsSync, statSync } from 'fs';
import type { WizardSession } from '@lib/wizard-session';
import type { AbortCase } from '@lib/agent/agent-runner';
import { detectWarehouseSources } from '@lib/warehouse-sources/detect';

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
    match: /^no data source detected$/i,
    message: 'No data source detected',
    body:
      'The agent could not confirm a data warehouse source to connect. ' +
      'Run this command from a project that uses a supported source ' +
      '(a database, Stripe, etc.).',
    docsUrl: 'https://posthog.com/docs/data-warehouse',
  },
  {
    // Skill emits: [ABORT] Source creation failed
    match: /^source creation failed$/i,
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
  } catch {
    fail({ kind: 'bad-directory', path: installDir, reason: 'unreadable' });
    return;
  }

  const sources = detectWarehouseSources(installDir);

  if (sources.length === 0) {
    fail({ kind: 'no-sources' });
    return;
  }

  setFrameworkContext('detectedWarehouseSources', sources);
}
