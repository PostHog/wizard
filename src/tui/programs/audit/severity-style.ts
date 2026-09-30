import type { AuditStatus } from '@shared/audit-ledger';

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
