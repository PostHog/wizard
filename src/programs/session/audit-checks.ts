import type { WizardSession } from '@programs/session/wizard-session';
import type { AuditCheck } from '@shared/audit-ledger';

export const AUDIT_CHECKS_KEY = 'auditChecks';

export function getAuditChecks(session: WizardSession): AuditCheck[] {
  const raw = session.frameworkContext[AUDIT_CHECKS_KEY];
  return Array.isArray(raw) ? (raw as AuditCheck[]) : [];
}
