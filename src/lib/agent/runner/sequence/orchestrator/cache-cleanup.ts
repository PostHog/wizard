import { rmSync } from 'fs';
import * as path from 'path';
import { analytics } from '@utils/analytics';
import { QUEUE_DIR_NAME } from './queue';

/**
 * Remove `<installDir>/.posthog-wizard-cache/`.
 *
 * Used from the orchestrator `finally` (success / throw unwind) and from
 * `registerCleanup` (wizardAbort / SIGINT) — the same dual-path pattern as
 * `flushScanReport` in the program runner.
 */
export function wipeOrchestratorCache(installDir: string): void {
  try {
    rmSync(path.join(installDir, QUEUE_DIR_NAME), {
      recursive: true,
      force: true,
    });
  } catch (err) {
    analytics.captureException(
      err instanceof Error ? err : new Error(String(err)),
      { step: 'orchestrator_cache_cleanup' },
    );
  }
}
