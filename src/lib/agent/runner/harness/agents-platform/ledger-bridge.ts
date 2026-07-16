/**
 * Mirrors the hosted agent's `resolve_checks` tool results onto the local audit
 * ledger, which AuditRunScreen file-watches and renders.
 *
 * This is what lets the cloud audit reuse the existing audit TUI unchanged: the
 * platform-side custom tool returns rows shaped exactly like `AuditCheck`, so
 * driving the screen is a matter of writing them to disk as they stream in.
 *
 * The catalog of checks deliberately lives in the agent's bundle, not here — we
 * seed the checklist from whatever the tool reports rather than keeping a second
 * copy the wizard would have to ship a release to change.
 */
import { logToFile } from '@utils/debug';

import { readLedger, writeLedgerAtomic } from '@lib/programs/audit/ledger';
import type { AuditCheck, AuditStatus } from '@lib/programs/audit/types';

/** Shape of the `resolve_checks` custom tool's return value. */
interface ResolveChecksOutput {
  catalog?: unknown;
  resolved?: unknown;
}

const VALID_STATUSES = new Set<string>([
  'pending',
  'pass',
  'error',
  'warning',
  'suggestion',
]);

/**
 * Coerce one row from the agent into an AuditCheck.
 *
 * The rows cross a network boundary from a separately-versioned bundle, so a
 * spec drift on either side lands here rather than as a corrupted checklist.
 * Anything unrecognizable is dropped, not clamped — a silently mis-rendered
 * status is worse than a missing row.
 */
function toAuditCheck(row: unknown): AuditCheck | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return null;
  if (typeof r.status !== 'string' || !VALID_STATUSES.has(r.status))
    return null;

  return {
    id: r.id,
    area: typeof r.area === 'string' ? r.area : 'Audit',
    label: typeof r.label === 'string' ? r.label : r.id,
    status: r.status as AuditStatus,
    ...(typeof r.file === 'string' ? { file: r.file } : {}),
    ...(typeof r.details === 'string' ? { details: r.details } : {}),
  };
}

function toAuditChecks(rows: unknown): AuditCheck[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(toAuditCheck).filter((c): c is AuditCheck => c !== null);
}

/**
 * Fold one `resolve_checks` result into the ledger at `ledgerPath`.
 *
 * The agent's `catalog` is authoritative about which checks exist: when it's
 * present the ledger becomes exactly that set, in that order. This is what
 * clears our "connecting" placeholder, and what stops a ledger left behind by a
 * previous (local, 12-check) audit run from merging into this one's — the file
 * lives in the user's project and outlives any single run.
 *
 * `resolved` rows are the agent's findings and win over both.
 *
 * Idempotent: the ledger is a pure function of the last output plus prior
 * statuses, so replaying an output — or reconnecting mid-run — can't double up.
 */
export function applyResolveChecksOutput(
  ledgerPath: string,
  output: unknown,
): void {
  if (!output || typeof output !== 'object') return;
  const { catalog, resolved } = output as ResolveChecksOutput;

  const catalogRows = toAuditChecks(catalog);
  const resolvedRows = toAuditChecks(resolved);
  if (catalogRows.length === 0 && resolvedRows.length === 0) return;

  const current = readLedger(ledgerPath);
  const currentById = new Map(current.map((c) => [c.id, c]));
  const resolvedById = new Map(resolvedRows.map((r) => [r.id, r]));

  // Each row shows the best status we know: this call's finding, else what we
  // already had, else pending from the catalog.
  const base = catalogRows.length > 0 ? catalogRows : current;
  const next: AuditCheck[] = base.map(
    (row) => resolvedById.get(row.id) ?? currentById.get(row.id) ?? row,
  );

  // A finding for a check the catalog didn't list shouldn't happen — the tool
  // validates ids against it — but surface it rather than swallow it.
  const seen = new Set(next.map((c) => c.id));
  for (const row of resolvedRows) {
    if (!seen.has(row.id)) next.push(row);
  }

  writeLedgerAtomic(ledgerPath, next);
  logToFile(
    `[cloud-audit] ledger: ${catalogRows.length} catalog, ${resolvedRows.length} resolved, ${next.length} total`,
  );
}
