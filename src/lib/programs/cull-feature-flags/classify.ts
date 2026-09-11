import type { FlagCallSite, FlagScanResult } from './scan.js';
import type { CullBucket, CullCandidate, FeatureFlag } from './types.js';

const MULTI_CALLSITE_FILE_THRESHOLD = 3;

const PROPOSED_ACTION_BY_BUCKET: Record<CullBucket, string> = {
  'dead-code-reference': 'delete dead module, disable flag',
  'archived-still-referenced': 'keep off path, drop check',
  'disabled-but-referenced': 'keep off path, drop check',
  'unreferenced-comment-only': 'disable flag, drop comment',
  unreferenced: 'disable flag',
  'fully-rolled-out': 'keep on path, drop check, disable flag',
  'never-enabled': 'keep off path, drop check, disable flag',
  'deleted-still-referenced': 'keep off path, drop check',
  'multi-callsite-no-wrapper': 'suggest one wrapper hook',
  healthy: 'keep',
};

/** What the ledger and the run screen show as the row's area. Keys the cull slides too. */
export const AREA_BY_BUCKET: Record<CullBucket, string> = {
  'dead-code-reference': 'Dead code',
  'archived-still-referenced': 'Archived in PostHog',
  'disabled-but-referenced': 'Disabled in PostHog',
  'unreferenced-comment-only': 'Comment only',
  unreferenced: 'Unreferenced',
  'fully-rolled-out': 'Rolled out',
  'never-enabled': 'Off for everyone',
  'deleted-still-referenced': 'Deleted in PostHog',
  'multi-callsite-no-wrapper': 'Many call sites',
  healthy: 'Healthy',
};

export type CullLane =
  | 'decided'
  | 'off-in-posthog'
  | 'not-in-code'
  | 'nothing-to-cull';

export const LANE_ORDER: readonly CullLane[] = [
  'decided',
  'off-in-posthog',
  'not-in-code',
  'nothing-to-cull',
];

export const LANE_LABEL: Record<CullLane, string> = {
  decided: 'Decided in PostHog',
  'off-in-posthog': 'Off in PostHog, still in code',
  'not-in-code': 'In PostHog, not in code',
  'nothing-to-cull': 'Nothing to cull',
};

const LANE_BY_BUCKET: Record<CullBucket, CullLane> = {
  'dead-code-reference': 'not-in-code',
  'archived-still-referenced': 'off-in-posthog',
  'disabled-but-referenced': 'off-in-posthog',
  'unreferenced-comment-only': 'not-in-code',
  unreferenced: 'not-in-code',
  'fully-rolled-out': 'decided',
  'never-enabled': 'decided',
  'deleted-still-referenced': 'off-in-posthog',
  'multi-callsite-no-wrapper': 'nothing-to-cull',
  healthy: 'nothing-to-cull',
};

export const LANE_BY_AREA: Record<string, CullLane> = Object.fromEntries(
  (Object.keys(AREA_BY_BUCKET) as CullBucket[]).map((bucket) => [
    AREA_BY_BUCKET[bucket],
    LANE_BY_BUCKET[bucket],
  ]),
);

/** Areas whose cull disables the flag in PostHog; the other areas leave PostHog untouched. */
export const DISABLING_AREAS: ReadonlySet<string> = new Set(
  (
    [
      'fully-rolled-out',
      'never-enabled',
      'unreferenced',
      'unreferenced-comment-only',
      'dead-code-reference',
    ] as CullBucket[]
  ).map((bucket) => AREA_BY_BUCKET[bucket]),
);

export const BUCKET_ORDER: readonly CullBucket[] = [
  'fully-rolled-out',
  'never-enabled',
  'archived-still-referenced',
  'disabled-but-referenced',
  'deleted-still-referenced',
  'unreferenced',
  'unreferenced-comment-only',
  'dead-code-reference',
  'multi-callsite-no-wrapper',
  'healthy',
];

const VERDICT_BY_BUCKET: Record<CullBucket, CullCandidate['verdict']> = {
  'dead-code-reference': 'stale',
  'archived-still-referenced': 'stale',
  'disabled-but-referenced': 'stale',
  'unreferenced-comment-only': 'stale',
  unreferenced: 'stale',
  'fully-rolled-out': 'stale',
  'never-enabled': 'stale',
  'deleted-still-referenced': 'stale',
  'multi-callsite-no-wrapper': 'warning',
  healthy: 'healthy',
};

function guardReason(flag: FeatureFlag): string | undefined {
  if ((flag.experiment_set?.length ?? 0) > 0) return 'backs an experiment';
  if (flag.is_remote_configuration) return 'remote configuration flag';
  if (flag.has_encrypted_payloads) return 'carries encrypted payloads';
  return undefined;
}

function isFullyRolledOut(flag: FeatureFlag): boolean {
  const groups = flag.filters?.groups ?? [];
  if (groups.length === 0) return false;
  if ((flag.filters?.multivariate?.variants?.length ?? 0) > 0) return false;
  return groups.every(
    (group) =>
      (group.rollout_percentage ?? 100) === 100 &&
      (group.properties?.length ?? 0) === 0,
  );
}

function isNeverEnabled(flag: FeatureFlag): boolean {
  const groups = flag.filters?.groups ?? [];
  if (groups.length === 0) return false;
  return groups.every((group) => group.rollout_percentage === 0);
}

function rolloutSummary(flag: FeatureFlag): string {
  const groups = flag.filters?.groups ?? [];
  const parts: string[] = [];
  if (groups.length === 0) parts.push('no release conditions');
  if (groups.length > 0) {
    const percentages = groups.map((group) =>
      String(group.rollout_percentage ?? 100),
    );
    parts.push(`rollout ${percentages.join('/')}%`);
  }
  if (groups.some((group) => (group.properties?.length ?? 0) > 0))
    parts.push('with property filters');
  if ((flag.filters?.multivariate?.variants?.length ?? 0) > 0)
    parts.push('multivariate');
  if (flag.archived) parts.push('archived');
  if (!flag.active) parts.push('inactive');
  if (flag.status) parts.push(flag.status);
  return parts.join(', ');
}

function reasonForBucket(bucket: CullBucket, summary: string): string {
  if (bucket !== 'never-enabled') return summary;
  return `${summary}; may be a rollback, verify before culling`;
}

function bucketForFlag(
  flag: FeatureFlag,
  sites: FlagCallSite[],
  hasMentions: boolean,
  reachableFiles: ReadonlySet<string>,
): CullBucket {
  if (sites.length === 0)
    return hasMentions ? 'unreferenced-comment-only' : 'unreferenced';
  if (sites.every((site) => !reachableFiles.has(site.file)))
    return 'dead-code-reference';
  if (flag.archived) return 'archived-still-referenced';
  if (!flag.active) return 'disabled-but-referenced';
  if (isFullyRolledOut(flag)) return 'fully-rolled-out';
  if (isNeverEnabled(flag)) return 'never-enabled';
  const distinctFiles = new Set(sites.map((site) => site.file));
  if (distinctFiles.size >= MULTI_CALLSITE_FILE_THRESHOLD)
    return 'multi-callsite-no-wrapper';
  return 'healthy';
}

function candidate(
  key: string,
  bucket: CullBucket,
  reason: string,
  sites: FlagCallSite[],
  flag?: FeatureFlag,
): CullCandidate {
  return {
    key,
    bucket,
    area: AREA_BY_BUCKET[bucket],
    verdict: VERDICT_BY_BUCKET[bucket],
    proposedAction: PROPOSED_ACTION_BY_BUCKET[bucket],
    reason,
    flagId: flag?.id,
    flagName: flag?.name,
    callSites: sites.map(({ file, line, api }) => ({ file, line, api })),
  };
}

/**
 * Pure classification of every PostHog flag plus every key the code evaluates
 * that PostHog no longer has. Rules only look at rollout, active, archived,
 * and the scan; age is never read.
 */
export function classifyFlags(
  flags: readonly FeatureFlag[],
  scan: FlagScanResult,
): CullCandidate[] {
  const sitesByKey = new Map<string, FlagCallSite[]>();
  for (const site of scan.callSites) {
    sitesByKey.set(site.key, [...(sitesByKey.get(site.key) ?? []), site]);
  }
  const mentionedKeys = new Set(scan.mentionSites.map((site) => site.key));
  const reachableFiles = new Set(scan.reachableFiles);
  const candidates: CullCandidate[] = [];

  for (const flag of flags) {
    if (flag.deleted) continue;
    const sites = sitesByKey.get(flag.key) ?? [];
    sitesByKey.delete(flag.key);
    if (flag.archived && sites.length === 0) continue;
    const summary = rolloutSummary(flag);
    const guard = guardReason(flag);
    if (guard) {
      candidates.push(
        candidate(flag.key, 'healthy', `${guard}; ${summary}`, sites, flag),
      );
      continue;
    }
    const bucket = bucketForFlag(
      flag,
      sites,
      mentionedKeys.has(flag.key),
      reachableFiles,
    );
    const reason = reasonForBucket(bucket, summary);
    candidates.push(candidate(flag.key, bucket, reason, sites, flag));
  }

  for (const [key, sites] of sitesByKey) {
    candidates.push(
      candidate(
        key,
        'deleted-still-referenced',
        'no flag with this key in PostHog (deleted or never created)',
        sites,
      ),
    );
  }

  return candidates;
}
