import type {
  AuditCheck,
  AuditStatus,
} from '../../../../../lib/workflows/audit/types.js';

const STATUS_ORDER: Record<AuditStatus, number> = {
  pending: 0,
  error: 1,
  warning: 2,
  suggestion: 3,
  pass: 4,
};

/** Pending at the top, resolved below by severity, then by area. */
export function sortChecks(checks: ReadonlyArray<AuditCheck>): AuditCheck[] {
  return [...checks].sort((a, b) => {
    const da = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (da !== 0) return da;
    return a.area.localeCompare(b.area);
  });
}
