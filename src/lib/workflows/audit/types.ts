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

export const AUDIT_CHECKS_FILE = '.posthog-audit-checks.json';
export const AUDIT_CHECKS_KEY = 'auditChecks';

export function getAuditChecks(session: WizardSession): AuditCheck[] {
  const raw = session.frameworkContext[AUDIT_CHECKS_KEY];
  return Array.isArray(raw) ? (raw as AuditCheck[]) : [];
}

const VALID_STATUS: ReadonlySet<AuditStatus> = new Set([
  'pending',
  'pass',
  'error',
  'warning',
  'suggestion',
]);

export function coerceAuditChecks(parsed: unknown): AuditCheck[] {
  if (!Array.isArray(parsed)) return [];
  const out: AuditCheck[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const status = e.status;
    if (typeof status !== 'string' || !VALID_STATUS.has(status as AuditStatus))
      continue;
    const id = typeof e.id === 'string' ? e.id : '';
    const area = typeof e.area === 'string' ? e.area : 'Other';
    const label = typeof e.label === 'string' ? e.label : '';
    if (!id || !label) continue;
    out.push({
      id,
      area,
      label,
      status: status as AuditStatus,
      file: typeof e.file === 'string' ? e.file : undefined,
      details: typeof e.details === 'string' ? e.details : undefined,
    });
  }
  return out;
}
