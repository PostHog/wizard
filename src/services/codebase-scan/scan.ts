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
import type {
  ProgramReadyContext,
  ProgramConfig,
} from '@programs/program-contract';
import type { ProgramSession } from '@programs/program-contract';
import { detectTools, toWarehouseSources } from '../warehouse-sources/detect';
import { loadSourceDetectors } from '../warehouse-sources/registry';
import type { DetectedSource, DetectedTool } from '../warehouse-sources/types';

/** frameworkContext key holding the full scan, every detected tool included. */
export const CODEBASE_SCAN_KEY = 'codebaseScan';

export type CodebaseScan = {
  /** The program whose detection ran the scan. */
  program: string;
  scannedAt: string;
  /**
   * The directory the scan walked. A CI run can narrow `installDir` after the
   * scan, so the report fingerprints this one instead.
   */
  scannedDir: string;
  tools: DetectedTool[];
  /** False when the walk stopped at a cap or skipped a directory it could not read. */
  complete: boolean;
  /** The scan threw or had no catalog to match against. Distinct from a scan that found nothing. */
  failed?: true;
};

type ScanContext = Pick<ProgramReadyContext, 'session' | 'setFrameworkContext'>;

/** Scan once per run, for a program that sets `scansCodebase`. Best-effort: never throws. */
export async function scanCodebaseFor(
  config: Pick<ProgramConfig, 'id' | 'scansCodebase'>,
  ctx: ScanContext,
): Promise<void> {
  if (!config.scansCodebase) return;
  if (getCodebaseScan(ctx.session)) return;
  const detectors = await loadSourceDetectors(ctx.session.baseUrl);
  const scannedAt = new Date().toISOString();
  const scannedDir = ctx.session.installDir;
  const failed: CodebaseScan = {
    program: config.id,
    scannedAt,
    scannedDir,
    tools: [],
    complete: false,
    failed: true,
  };
  // No catalog means the scan could not look, which is not the same as
  // finding nothing. The loader has already reported why.
  if (detectors.length === 0) {
    ctx.setFrameworkContext(CODEBASE_SCAN_KEY, failed);
    return;
  }
  try {
    const { tools, complete } = detectTools(scannedDir, detectors);
    ctx.setFrameworkContext(CODEBASE_SCAN_KEY, {
      program: config.id,
      scannedAt,
      scannedDir,
      tools,
      complete,
    } satisfies CodebaseScan);
  } catch (error) {
    ctx.setFrameworkContext(CODEBASE_SCAN_KEY, failed);
    analytics.captureException(
      error instanceof Error ? error : new Error(String(error)),
      { step: 'scanCodebase' },
    );
  }
}

/** The warehouse sources the scan found, for a program that offers them. */
export async function scannedWarehouseSources(
  session: ProgramSession,
): Promise<DetectedSource[]> {
  const scan = getCodebaseScan(session);
  if (!scan) return [];
  // Resolves at once: the scan already waited for the same download.
  return toWarehouseSources(
    scan.tools,
    await loadSourceDetectors(session.baseUrl),
  );
}

export function getCodebaseScan(
  session: Pick<ProgramSession, 'frameworkContext'>,
): CodebaseScan | undefined {
  return session.frameworkContext[CODEBASE_SCAN_KEY] as
    | CodebaseScan
    | undefined;
}
