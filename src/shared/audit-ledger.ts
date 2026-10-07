/**
 * The audit ledger's contract: the file the audit tools write into the user's
 * project, the check shape inside it, and the read-side coercion. Shared by
 * the agent's ledger tools (both harnesses), the scanner's documentation
 * allowlist and the audit program that watches the file.
 */

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

export const AUDIT_CHECKS_FILE = '.posthog-audit-checks.json';
export const AUDIT_REPORT_FILE = 'posthog-audit-report.md';

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
