/**
 * Mirrors the agent's `.posthog-audit-checks.json` into the session, so the TUI
 * screens and the task stream read one value. `runAgent` owns the lifecycle, so
 * every path gets it — including the e2e host, which builds no task stream.
 */

import { getUI } from '@ui';
import type { FileWatcherHandle, FileWatcherOptions } from '@lib/file-watcher';
import { AUDIT_CHECKS_KEY } from './types.js';
import { watchAuditLedger } from './watch-ledger.js';

export function startAuditLedgerWatcher(
  installDir: string,
  file: string,
  options: FileWatcherOptions = {},
): FileWatcherHandle {
  return watchAuditLedger(
    installDir,
    file,
    (checks) => getUI().setFrameworkContext(AUDIT_CHECKS_KEY, checks),
    options,
  );
}
