import type { AuditCheck } from '@shared/audit-ledger';
import type { ProgramSession } from '../program-session';

/** The framework-context key an audit run keeps its ledger's checks under. */
export const AUDIT_CHECKS_KEY = 'auditChecks';

/** The audit ledger's checks as the session holds them, for a host's task stream and the audit screens. */
export function getAuditChecks(session: ProgramSession): AuditCheck[] {
  const raw = session.frameworkContext[AUDIT_CHECKS_KEY];
  return Array.isArray(raw) ? (raw as AuditCheck[]) : [];
}
