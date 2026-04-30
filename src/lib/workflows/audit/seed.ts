import fs from 'fs';
import path from 'path';
import { logToFile } from '../../../utils/debug';
import { AUDIT_CHECKS_FILE, type AuditCheck } from './types.js';

/** The 9 data-integrity checks the audit runs. */
export const AUDIT_SEED_CHECKS: AuditCheck[] = [
  {
    id: 'sdk-installed',
    area: 'Installation',
    label: 'PostHog SDK installed',
    status: 'pending',
  },
  {
    id: 'sdk-up-to-date',
    area: 'Installation',
    label: 'SDK version up to date',
    status: 'pending',
  },
  {
    id: 'init-correct',
    area: 'Installation',
    label: 'Initialization is correct',
    status: 'pending',
  },
  {
    id: 'identify-stable-distinct-id',
    area: 'Identification',
    label: 'Stable distinct_id (not session UUID)',
    status: 'pending',
  },
  {
    id: 'identify-not-late',
    area: 'Identification',
    label: 'identify() called before captures / flag evals',
    status: 'pending',
  },
  {
    id: 'cross-runtime-distinct-id',
    area: 'Identification',
    label: 'Same distinct_id across client and server',
    status: 'pending',
  },
  {
    id: 'capture-event-names-static',
    area: 'Event Capture',
    label: 'Event names are static strings',
    status: 'pending',
  },
  {
    id: 'capture-anon-distinct-id',
    area: 'Event Capture',
    label: 'Truly anonymous events disable person processing',
    status: 'pending',
  },
  {
    id: 'capture-growth-events',
    area: 'Event Capture',
    label: 'Signup / activation / purchase tracked',
    status: 'pending',
  },
];

/** Atomically write the seeded ledger to the project's audit checks file. */
export function seedAuditLedger(installDir: string): void {
  const target = path.join(installDir, AUDIT_CHECKS_FILE);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(AUDIT_SEED_CHECKS, null, 2), 'utf8');
  fs.renameSync(tmp, target);
  logToFile(
    `seedAuditLedger: wrote ${AUDIT_SEED_CHECKS.length} entries to ${target}`,
  );
}
