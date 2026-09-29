/**
 * Mirrors the agent's `.posthog-audit-checks.json` into the framework context,
 * so the TUI screens and the task stream read one value. `runProgram` starts it
 * for a config with `auditLedgerFile` and removes the file at run end, so every
 * host gets it.
 */

import fs from 'fs';
import path from 'path';
import type { RunnerContext } from '../runner-context';
import {
  startFileWatcher,
  type FileWatcherHandle,
  type FileWatcherOptions,
} from '@utils/file-watcher';
import { logToFile } from '@utils/debug';
import { AUDIT_CHECKS_KEY, coerceAuditChecks } from './types';

const MAX_LEDGER_FILE_BYTES = 256 * 1024;

export function startAuditLedgerWatcher(
  installDir: string,
  file: string,
  runner: Pick<RunnerContext, 'setFrameworkContext'>,
  options: FileWatcherOptions = {},
): FileWatcherHandle {
  const target = path.join(installDir, file);
  logToFile(`[audit-ledger] watching ${target}`);

  return startFileWatcher(
    target,
    (parsed) =>
      runner.setFrameworkContext(AUDIT_CHECKS_KEY, coerceAuditChecks(parsed)),
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
