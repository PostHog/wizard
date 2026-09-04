import { seedAuditLedger } from '@lib/programs/audit/seed';
import type { AuditCheck } from '@lib/programs/audit/types';
import type { FlagScanResult } from './scan.js';
import type { CullCandidate } from './types.js';

export const CULLED_MARKER = '; culled';

// The row's `file` already names the first site, so details only add the rest.
function describeSites(candidate: CullCandidate): string | undefined {
  if (candidate.callSites.length === 0) return 'no call sites';
  if (candidate.callSites.length === 1) return undefined;
  const rest = candidate.callSites
    .slice(1)
    .map((site) => `${site.file}:${site.line}`);
  return `also ${rest.join(', ')}`;
}

export function candidateToCheck(candidate: CullCandidate): AuditCheck {
  const first = candidate.callSites[0];
  return {
    id: candidate.key,
    area: candidate.area,
    label: `${candidate.key}: ${candidate.proposedAction}`,
    status: candidate.verdict === 'healthy' ? 'pass' : 'pending',
    ...(first ? { file: `${first.file}:${first.line}` } : {}),
    details: [candidate.reason, describeSites(candidate)]
      .filter(Boolean)
      .join('; '),
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
}

function countByBucket(candidates: readonly CullCandidate[]): string[] {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    counts.set(candidate.area, (counts.get(candidate.area) ?? 0) + 1);
  }
  return [...counts.entries()].map(
    ([bucket, count]) => `- ${bucket}: ${count}`,
  );
}

export function buildCullPrompt(input: CullPromptInput): string {
  const yesNo = (value: boolean): string => (value ? 'yes' : 'no');
  const dynamicSites = input.scan.dynamicSites.map(
    (site) => `${site.file}:${site.line} (${site.api})`,
  );
  return [
    `Run the cull-feature-flags skill end-to-end. The ledger at ./${input.ledgerFile} is ground truth, one row per flag, grouped by area:`,
    ...countByBucket(input.candidates),
    '',
    "Scan facts (deterministic, from the wizard's scan of this project):",
    `- Bulk evaluation (getAllFlags): ${yesNo(input.scan.usesBulkEvaluation)}`,
    `- Dynamic flag keys: ${
      dynamicSites.length > 0 ? dynamicSites.join(', ') : 'none'
    }`,
    `- Scan truncated at the file limit: ${yesNo(input.scan.truncated)}`,
  ].join('\n');
}
