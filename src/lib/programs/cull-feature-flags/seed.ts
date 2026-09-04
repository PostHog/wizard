import { seedAuditLedger } from '@lib/programs/audit/seed';
import type { AuditCheck } from '@lib/programs/audit/types';
import type { FlagScanResult } from './scan.js';
import type { CullCandidate } from './types.js';

export const APPLIED_MARKER = '; applied';

function describeSites(candidate: CullCandidate): string {
  if (candidate.callSites.length === 0) return 'no call sites';
  const sites = candidate.callSites.map(
    (site) => `${site.file}:${site.line} (${site.api})`,
  );
  return `sites: ${sites.join(', ')}`;
}

export function candidateToCheck(candidate: CullCandidate): AuditCheck {
  const first = candidate.callSites[0];
  return {
    id: candidate.key,
    area: candidate.bucket,
    label: `${candidate.key}: ${candidate.proposedAction}`,
    status: candidate.verdict === 'healthy' ? 'pass' : 'pending',
    ...(first ? { file: `${first.file}:${first.line}` } : {}),
    details: `${candidate.reason}; ${describeSites(candidate)}`,
  };
}

export function seedCullLedger(
  installDir: string,
  candidates: readonly CullCandidate[],
): AuditCheck[] {
  const checks = candidates.map(candidateToCheck);
  seedAuditLedger(installDir, checks);
  return checks;
}

export interface CullPromptInput {
  ledgerFile: string;
  candidates: readonly CullCandidate[];
  scan: FlagScanResult;
  postHogFetchFailed: boolean;
}

function countByBucket(candidates: readonly CullCandidate[]): string[] {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    counts.set(candidate.bucket, (counts.get(candidate.bucket) ?? 0) + 1);
  }
  return [...counts.entries()].map(
    ([bucket, count]) => `- ${bucket}: ${count}`,
  );
}

export function buildCullPrompt(input: CullPromptInput): string {
  const lines = [
    'Run the cull-feature-flags skill end-to-end. The wizard already scanned this project and fetched its PostHog flags; the ledger at',
    `./${input.ledgerFile} is ground truth, one row per flag, area = bucket:`,
    ...countByBucket(input.candidates),
    '',
    'Never grep for flags or re-classify a row. Resolve rows only through audit_resolve_checks. Ask exactly once which rows to apply, decline option first. Disable flags only, never delete or archive. Code edits land before the PostHog disable.',
  ];
  if (input.scan.usesBulkEvaluation) {
    lines.push(
      'This project calls getAllFlags, so a flag with no literal call site may still be read out of that result. Verify every unreferenced row at the bulk call site before proposing it.',
    );
  }
  if (input.scan.dynamicSites.length > 0) {
    const sites = input.scan.dynamicSites.map(
      (site) => `${site.file}:${site.line} (${site.api})`,
    );
    lines.push(
      `Flag keys are also evaluated dynamically at ${sites.join(
        ', ',
      )}. Verify every unreferenced row against those sites before proposing it.`,
    );
  }
  if (input.scan.truncated) {
    lines.push(
      'The scan hit its file limit, so "unreferenced" is not proven. Treat every unreferenced row as verify-first.',
    );
  }
  if (input.postHogFetchFailed) {
    lines.push(
      'The PostHog flag fetch failed, so only code-side buckets are seeded. Propose nothing, write the report and say so.',
    );
  }
  return lines.join('\n');
}
