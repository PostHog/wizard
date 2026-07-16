/**
 * The cloud audit's placeholder ledger.
 *
 * Unlike the local audit, we do NOT seed the real checklist here. The catalog
 * of checks lives in the hosted agent's bundle and arrives on its first
 * `resolve_checks` result (see ledger-bridge.ts) — keeping a second copy in the
 * wizard would mean a wizard release every time the audit's checklist changed,
 * which is the coupling this whole path exists to break.
 *
 * So this seeds exactly one row: something for the run screen to show in the
 * second before the agent answers.
 */
import { AUDIT_CHECKS_KEY, type AuditCheck } from '@lib/programs/audit/types';
import { seedAuditLedger } from '@lib/programs/audit/seed';
import type { WizardSession } from '@lib/wizard-session';

export const CLOUD_AUDIT_PLACEHOLDER_CHECKS: AuditCheck[] = [
  {
    id: 'cloud-audit-connect',
    area: 'Audit',
    label: 'Connecting to the PostHog audit agent',
    status: 'pending',
  },
];

export function seedCloudAuditLedger(installDir: string): void {
  seedAuditLedger(installDir, CLOUD_AUDIT_PLACEHOLDER_CHECKS);
}

export function seedCloudAuditSession(session: WizardSession): void {
  seedCloudAuditLedger(session.installDir);
  session.frameworkContext[AUDIT_CHECKS_KEY] = CLOUD_AUDIT_PLACEHOLDER_CHECKS;
}
