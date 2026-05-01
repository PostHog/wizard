import type {
  AuditCheck,
  AuditStatus,
} from '../../../../../lib/workflows/audit/types.js';

const STATUS_ORDER: Record<AuditStatus, number> = {
  error: 0,
  warning: 1,
  suggestion: 2,
  pass: 3,
  pending: 4,
};

/** Issues at the top (error → warning → suggestion), then passes, then pending todos. */
export function sortChecks(checks: ReadonlyArray<AuditCheck>): AuditCheck[] {
  return [...checks].sort((a, b) => {
    const da = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (da !== 0) return da;
    return a.area.localeCompare(b.area);
  });
}
