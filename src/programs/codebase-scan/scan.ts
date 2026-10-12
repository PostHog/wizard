/**
 * The run's one codebase scan. Every program that sets `scansCodebase` reads
 * this result instead of scanning on its own, so local suggestions, the
 * warehouse flow, the self-driving prompt and the report all agree. Each
 * program derives its own view from it in `onReady`; the scan writes no
 * program's keys, so a composed run sees only what its own program chose.
 *
 * Scanning always runs; consent only gates reporting (see `report.ts`).
 */

import { analytics } from '@utils/analytics';
import type { ProgramReadyContext, ProgramConfig } from '../program-step';
import type { ProgramSession } from '../program-session';
import { detectTools, toWarehouseSources } from '../warehouse-sources/detect';
import type { DetectedSource, DetectedTool } from '../warehouse-sources/types';

/** frameworkContext key holding the full scan, every detected tool included. */
export const CODEBASE_SCAN_KEY = 'codebaseScan';

export type CodebaseScan = {
  /** The program whose detection ran the scan. */
  program: string;
  scannedAt: string;
  tools: DetectedTool[];
  /** The scan threw. Distinct from a scan that found nothing. */
  failed?: true;
};

type ScanContext = Pick<ProgramReadyContext, 'session' | 'setFrameworkContext'>;

/** Scan once per run, for a program that sets `scansCodebase`. Best-effort: never throws. */
export function scanCodebaseFor(
  config: Pick<ProgramConfig, 'id' | 'scansCodebase'>,
  ctx: ScanContext,
): void {
  if (!config.scansCodebase) return;
  if (getCodebaseScan(ctx.session)) return;
  const scannedAt = new Date().toISOString();
  try {
    const tools = detectTools(ctx.session.installDir);
    ctx.setFrameworkContext(CODEBASE_SCAN_KEY, {
      program: config.id,
      scannedAt,
      tools,
    } satisfies CodebaseScan);
  } catch (error) {
    ctx.setFrameworkContext(CODEBASE_SCAN_KEY, {
      program: config.id,
      scannedAt,
      tools: [],
      failed: true,
    } satisfies CodebaseScan);
    analytics.captureException(
      error instanceof Error ? error : new Error(String(error)),
      { step: 'scanCodebase' },
    );
  }
}

/** The warehouse sources the scan found, for a program that offers them. */
export function scannedWarehouseSources(
  session: ProgramSession,
): DetectedSource[] {
  const scan = getCodebaseScan(session);
  return scan ? toWarehouseSources(scan.tools) : [];
}

export function getCodebaseScan(
  session: ProgramSession,
): CodebaseScan | undefined {
  return session.frameworkContext[CODEBASE_SCAN_KEY] as
    | CodebaseScan
    | undefined;
}
