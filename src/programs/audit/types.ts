import {
  AUDIT_CHECKS_FILE,
  AUDIT_REPORT_FILE,
  coerceAuditChecks,
  type AuditCheck,
  type AuditStatus,
} from '@shared/run/audit-ledger';

// The ledger contract lives in `@lib/audit-ledger`; re-exported so the audit
// views and the ledger watcher keep their import path.
export { AUDIT_CHECKS_FILE, AUDIT_REPORT_FILE, coerceAuditChecks };
export type { AuditCheck, AuditStatus };

export interface AuditSeverityStyle {
  glyph: string;
  color: string;
}

/** Single source of truth for status glyph + color across audit views. */
export const AUDIT_SEVERITY_STYLE: Record<AuditStatus, AuditSeverityStyle> = {
  pending: { glyph: '◌', color: 'gray' },
  pass: { glyph: '✔', color: 'green' },
  error: { glyph: '✘', color: 'red' },
  warning: { glyph: '⚠', color: 'yellow' },
  suggestion: { glyph: '•', color: 'cyan' },
};

export const AUDIT_CHECKS_KEY = 'auditChecks';

export function getAuditChecks(session: {
  frameworkContext: Record<string, unknown>;
}): AuditCheck[] {
  const raw = session.frameworkContext[AUDIT_CHECKS_KEY];
  return Array.isArray(raw) ? (raw as AuditCheck[]) : [];
}
