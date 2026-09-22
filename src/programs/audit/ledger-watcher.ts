/**
 * Mirrors the agent's `.posthog-audit-checks.json` into the session, so the TUI
 * screens and the task stream read one value. `runAgent` owns the lifecycle, so
 * every path gets it — including the e2e host, which builds no task stream.
 */

import type {
  FileWatcherHandle,
  FileWatcherOptions,
} from '@shared/file-watcher';
import type { AuditCheck } from '@shared/audit-ledger';
import { watchAuditLedger } from './watch-ledger.js';

export function startAuditLedgerWatcher(
  installDir: string,
  file: string,
  onChecks: (checks: AuditCheck[]) => void,
  options: FileWatcherOptions = {},
): FileWatcherHandle {
  return watchAuditLedger(installDir, file, onChecks, options);
}
