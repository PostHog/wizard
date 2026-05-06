import fs from 'fs';
import path from 'path';
import { logToFile } from '../../../utils/debug';
import { AUDIT_CHECKS_FILE, type AuditCheck } from './types.js';
import { AUDIT_SPECIALISTS } from './specialists.js';

/** Core install/init checks the runner executes inline (no specialist). */
export const AUDIT_CORE_CHECKS: AuditCheck[] = [
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
];

/**
 * The 10 always-pre-seeded checks: 3 core install/init + every basic
 * specialist's checks (identification, event-capture). Discoverable
 * specialists' checks are enrolled mid-run by the runner via
 * `audit_add_checks` and never appear here.
 */
export const AUDIT_SEED_CHECKS: AuditCheck[] = [
  ...AUDIT_CORE_CHECKS,
  ...AUDIT_SPECIALISTS.flatMap((specialist) =>
    specialist.checks.map((check) => ({
      ...check,
      status: 'pending' as const,
    })),
  ),
];

/** Atomically write the seeded ledger to the project's audit checks file. */
export function seedAuditLedger(installDir: string): AuditCheck[] {
  const target = path.join(installDir, AUDIT_CHECKS_FILE);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(AUDIT_SEED_CHECKS, null, 2), 'utf8');
  fs.renameSync(tmp, target);
  logToFile(
    `seedAuditLedger: wrote ${AUDIT_SEED_CHECKS.length} entries to ${target}`,
  );
  return AUDIT_SEED_CHECKS;
}
