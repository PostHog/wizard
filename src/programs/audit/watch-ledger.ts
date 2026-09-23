import path from 'node:path';
import {
  startFileWatcher,
  type FileWatcherHandle,
  type FileWatcherOptions,
} from '@utils/file-watcher';
import { coerceAuditChecks, type AuditCheck } from '@shared/run/audit-ledger';
import { logToFile } from '@utils/debug';

const MAX_LEDGER_FILE_BYTES = 256 * 1024;

/** Watch this run's audit ledger and project valid ledger arrays to a caller. */
export function watchAuditLedger(
  installDir: string,
  file: string,
  onChecks: (checks: AuditCheck[]) => void,
  options: FileWatcherOptions = {},
): FileWatcherHandle {
  const target = path.join(installDir, file);
  logToFile(`[audit-ledger] watching ${target}`);

  return startFileWatcher(
    target,
    (parsed) => onChecks(coerceAuditChecks(parsed)),
    {
      // A ledger an earlier run left behind stays ignored until this run writes.
      ignoreInitialFile: true,
      maxFileSizeBytes: MAX_LEDGER_FILE_BYTES,
      ...options,
    },
  );
}
