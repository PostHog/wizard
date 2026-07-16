/**
 * Pure operations on the audit checks ledger (`.posthog-audit-checks.json`).
 *
 * The ledger is the audit's live progress surface: AuditRunScreen file-watches
 * it and renders whatever it holds. Two very different producers write it —
 * the local agent's `audit_*` MCP tools (see wizard-tools.ts) and the cloud
 * audit runner, which mirrors a remote agent's tool results onto disk. Both
 * need the same read-modify-write semantics, so they live here rather than
 * inside either producer.
 */
import * as fs from 'fs';

import { writeJsonAtomic } from '@utils/atomic-ledger';

import {
  coerceAuditChecks,
  type AuditCheck,
  type AuditStatus,
} from './types.js';

export interface AuditUpdate {
  id: string;
  status: AuditStatus;
  file?: string;
  details?: string;
}

/** Atomically write the audit ledger. Thin typed wrapper over writeJsonAtomic. */
export function writeLedgerAtomic(
  targetPath: string,
  checks: AuditCheck[],
): void {
  writeJsonAtomic(targetPath, checks);
}

export function readLedger(targetPath: string): AuditCheck[] {
  if (!fs.existsSync(targetPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    return coerceAuditChecks(parsed);
  } catch {
    return [];
  }
}

/**
 * Apply a batch of patches to the ledger by id. Returns the new array and the
 * list of update ids that didn't match any existing check.
 */
export function applyAuditUpdates(
  current: AuditCheck[],
  updates: AuditUpdate[],
): { next: AuditCheck[]; unknown: string[] } {
  const byId = new Map(current.map((c) => [c.id, c]));
  const unknown: string[] = [];

  for (const u of updates) {
    const existing = byId.get(u.id);
    if (!existing) {
      unknown.push(u.id);
      continue;
    }
    byId.set(u.id, {
      ...existing,
      status: u.status,
      ...(u.file !== undefined ? { file: u.file } : {}),
      ...(u.details !== undefined ? { details: u.details } : {}),
    });
  }

  return {
    next: current.map((c) => byId.get(c.id) ?? c),
    unknown,
  };
}

/**
 * Append new checks to a seeded ledger. Duplicate ids are reported without
 * mutating the current ledger, including duplicates inside the additions.
 */
export function applyAuditAdditions(
  current: AuditCheck[],
  additions: AuditCheck[],
): { next: AuditCheck[]; duplicates: string[] } {
  const existingIds = new Set(current.map((c) => c.id));
  const additionIds = new Set<string>();
  const duplicates: string[] = [];

  for (const check of additions) {
    if (existingIds.has(check.id) || additionIds.has(check.id)) {
      duplicates.push(check.id);
      continue;
    }
    additionIds.add(check.id);
  }

  if (duplicates.length > 0) {
    return { next: current, duplicates };
  }

  return { next: [...current, ...additions], duplicates: [] };
}

export type AppendAuditChecksResult =
  | { ok: true; added: number }
  | { ok: false; reason: 'missing-ledger' }
  | { ok: false; reason: 'duplicate-ids'; ids: string[] };

export function appendAuditChecksToLedger(
  targetPath: string,
  additions: AuditCheck[],
): AppendAuditChecksResult {
  if (!fs.existsSync(targetPath)) {
    return { ok: false, reason: 'missing-ledger' };
  }

  const current = readLedger(targetPath);
  const { next, duplicates } = applyAuditAdditions(current, additions);
  if (duplicates.length > 0) {
    return { ok: false, reason: 'duplicate-ids', ids: duplicates };
  }

  writeLedgerAtomic(targetPath, next);
  return { ok: true, added: additions.length };
}
