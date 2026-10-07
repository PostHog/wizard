import type { AuditCheck } from '@shared/audit-ledger';
import type { ProgramSession } from '../program-session';

export const AUDIT_CHECKS_KEY = 'auditChecks';

export function getAuditChecks(session: ProgramSession): AuditCheck[] {
  const raw = session.frameworkContext[AUDIT_CHECKS_KEY];
  return Array.isArray(raw) ? (raw as AuditCheck[]) : [];
}
