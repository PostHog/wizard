import type { AuditCheck, AuditStatus } from '@lib/programs/audit/types';

const STATUS_ORDER: Record<AuditStatus, number> = {
  error: 0,
  warning: 1,
  suggestion: 2,
  pass: 3,
  pending: 4,
};

/** Audit areas in the order they should be displayed. Areas not listed
 *  here fall through to alphabetical order at the end. Mirrors the
 *  Full audit section grouping in the generated report. */
const AREA_ORDER: string[] = [
  'Installation',
  'Identification',
  'Event Capture',
  'Event Quality',
  'Feature Flags',
  'Session Replay',
  'Session Replay — Optimize',
  'Stack consolidation',
  'Wrap-up & notebook',
];

function areaRank(area: string): number {
  const idx = AREA_ORDER.indexOf(area);
  return idx === -1 ? AREA_ORDER.length : idx;
}

/** Issues at the top (error → warning → suggestion), then passes, then pending todos. */
export function sortChecks(checks: ReadonlyArray<AuditCheck>): AuditCheck[] {
  return [...checks].sort((a, b) => {
    const da = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (da !== 0) return da;
    return a.area.localeCompare(b.area);
  });
}

export interface AreaGroup {
  area: string;
  checks: AuditCheck[];
  counts: { total: number; resolved: number };
}

/** Group checks by area, in AREA_ORDER. Within each area, sort by status. */
export function groupChecksByArea(
  checks: ReadonlyArray<AuditCheck>,
): AreaGroup[] {
  const byArea = new Map<string, AuditCheck[]>();
  for (const c of checks) {
    const list = byArea.get(c.area);
    if (list) list.push(c);
    else byArea.set(c.area, [c]);
  }
  const groups: AreaGroup[] = [];
  for (const [area, areaChecks] of byArea) {
    const sorted = [...areaChecks].sort(
      (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
    );
    const resolved = sorted.filter((c) => c.status !== 'pending').length;
    groups.push({
      area,
      checks: sorted,
      counts: { total: sorted.length, resolved },
    });
  }
  groups.sort((a, b) => {
    const dr = areaRank(a.area) - areaRank(b.area);
    if (dr !== 0) return dr;
    return a.area.localeCompare(b.area);
  });
  return groups;
}
