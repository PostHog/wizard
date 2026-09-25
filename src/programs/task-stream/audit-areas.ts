/**
 * Audit ledger → stream tasks: one row per audit *area*, never per check.
 *
 * A run resolves tens of checks, and each row carries a `file` path and a
 * `details` string derived from the user's code. Neither belongs on the wire.
 * A finding is progress, not a failure, so an area never reports `failed`.
 */

import type { AuditCheck, AuditStatus } from '@programs/audit/types';
import { StreamTaskStatus, type StreamTask } from './types';

export const MAX_AUDIT_AREAS = 24;
const MAX_AREA_TITLE_LENGTH = 80;

const RESOLVED: readonly AuditStatus[] = [
  'pass',
  'error',
  'warning',
  'suggestion',
];

function areaTitle(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim().slice(0, MAX_AREA_TITLE_LENGTH);
}

/** `idOffset` continues the program's task ids, which are stringified integers. */
export function rollUpAuditAreas(checks: unknown, idOffset = 0): StreamTask[] {
  if (!Array.isArray(checks)) return [];

  // Map keeps insertion order, which is the order the ledger seeds its areas in.
  const areas = new Map<string, { total: number; resolved: number }>();

  for (const entry of checks) {
    if (!entry || typeof entry !== 'object') continue;
    const title = areaTitle((entry as Partial<AuditCheck>).area);
    if (!title) continue;

    let counts = areas.get(title);
    if (!counts) {
      if (areas.size >= MAX_AUDIT_AREAS) continue;
      counts = { total: 0, resolved: 0 };
      areas.set(title, counts);
    }
    counts.total += 1;
    // The ledger is agent-written: anything unrecognized counts as unresolved.
    if (RESOLVED.includes((entry as Partial<AuditCheck>).status as AuditStatus))
      counts.resolved += 1;
  }

  return [...areas.entries()].map(([title, { total, resolved }], index) => ({
    id: String(idOffset + index),
    title,
    status:
      resolved === 0
        ? StreamTaskStatus.Pending
        : resolved < total
        ? StreamTaskStatus.InProgress
        : StreamTaskStatus.Completed,
  }));
}
