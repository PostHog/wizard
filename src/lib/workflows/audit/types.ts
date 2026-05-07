import type { WizardSession } from '../../wizard-session.js';

export type AuditStatus =
  | 'pending'
  | 'pass'
  | 'error'
  | 'warning'
  | 'suggestion';

export interface AuditCheck {
  id: string;
  area: string;
  label: string;
  status: AuditStatus;
  file?: string;
  details?: string;
}

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

export const AUDIT_CHECKS_FILE = '.posthog-audit-checks.json';
export const AUDIT_REPORT_FILE = 'posthog-audit-report.md';
export const AUDIT_CHECKS_KEY = 'auditChecks';

export function getAuditChecks(session: WizardSession): AuditCheck[] {
  const raw = session.frameworkContext[AUDIT_CHECKS_KEY];
  return Array.isArray(raw) ? (raw as AuditCheck[]) : [];
}

/**
 * Read the audit checks ledger off disk. Validation lives at write time —
 * every writer (`audit_seed_checks` / `audit_add_checks` / `audit_resolve_checks`
 * MCP tools, `seedAuditLedger`) zod-parses entries before the atomic write,
 * so by the time the file watcher fires we trust the shape and only guard
 * against the file not being a JSON array (corrupted / hand-edited / not yet
 * seeded).
 */
export function coerceAuditChecks(parsed: unknown): AuditCheck[] {
  return Array.isArray(parsed) ? (parsed as AuditCheck[]) : [];
}
