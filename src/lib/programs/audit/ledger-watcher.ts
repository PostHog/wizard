/**
 * Mirrors the agent's `.posthog-audit-checks.json` into the session, so the TUI
 * screens and the task stream read one value. `runProgramAgent` owns the
 * lifecycle and removes the file at run end, so every path gets it — including
 * the e2e host, which builds no task stream.
 */

import fs from 'fs';
import path from 'path';
import { getUI } from '@ui';
import {
  startFileWatcher,
  type FileWatcherHandle,
  type FileWatcherOptions,
} from '@lib/file-watcher';
import { logToFile } from '@utils/debug';
import { AUDIT_CHECKS_KEY, coerceAuditChecks } from './types.js';

const MAX_LEDGER_FILE_BYTES = 256 * 1024;

export function startAuditLedgerWatcher(
  installDir: string,
  file: string,
  options: FileWatcherOptions = {},
): FileWatcherHandle {
  const target = path.join(installDir, file);
  logToFile(`[audit-ledger] watching ${target}`);

  return startFileWatcher(
    target,
    (parsed) =>
      getUI().setFrameworkContext(AUDIT_CHECKS_KEY, coerceAuditChecks(parsed)),
    {
      // A ledger an earlier run left behind stays ignored until this run writes.
      ignoreInitialFile: true,
      maxFileSizeBytes: MAX_LEDGER_FILE_BYTES,
      ...options,
    },
  );
}

/** The program declared the ledger, so it removes it, agent `rm` step or not. */
export function removeAuditLedger(installDir: string, file: string): void {
  const target = path.join(installDir, file);
  try {
    fs.rmSync(target, { force: true });
  } catch (error) {
    logToFile(`[audit-ledger] could not remove ${target}: ${String(error)}`);
  }
}
