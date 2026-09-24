import path from 'node:path';
import type { FileWatcherHandle } from '@shared/file-watcher';
import { AUDIT_CHECKS_KEY } from './audit/types.js';
import { seedAuditLedger } from './audit/seed.js';
import { watchAuditLedger } from './audit/watch-ledger.js';
import { ProgramEventPlanWatcher } from './posthog-integration/watch-event-plan.js';
import type { ProgramStore } from './program-store.js';
import type { ProgramSettings } from './run-program.js';

export type ProgramFileWatchers = {
  seedAuditLedger(): void;
  refresh(): void;
  stop(): void;
};

/** Own the files emitted by this invocation until its agent run settles. */
export function startProgramFileWatchers(
  program: Pick<
    ProgramSettings,
    'auditLedgerFile' | 'auditSeedChecks' | 'eventPlanFile'
  >,
  installDir: string,
  store: ProgramStore,
): ProgramFileWatchers {
  const ledger: FileWatcherHandle | null = program.auditLedgerFile
    ? watchAuditLedger(installDir, program.auditLedgerFile, (checks) =>
        store.setFrameworkContext(AUDIT_CHECKS_KEY, checks),
      )
    : null;
  const eventPlan: ProgramEventPlanWatcher | null = program.eventPlanFile
    ? new ProgramEventPlanWatcher(
        path.join(installDir, program.eventPlanFile),
        (events) => store.setEventPlan(events),
      )
    : null;

  try {
    eventPlan?.start();
  } catch (error) {
    ledger?.stop();
    throw error;
  }

  return {
    seedAuditLedger() {
      if (!program.auditSeedChecks) return;
      // The watcher already took its ignore-initial snapshot. This write is
      // part of this invocation and must be visible before the agent starts.
      seedAuditLedger(installDir, [...program.auditSeedChecks]);
      store.setFrameworkContext(AUDIT_CHECKS_KEY, program.auditSeedChecks);
      ledger?.refresh();
    },
    refresh() {
      ledger?.refresh();
      eventPlan?.refresh();
    },
    stop() {
      ledger?.stop();
      eventPlan?.stop();
    },
  };
}
