import {
  buildCullPrompt,
  candidateToCheck,
} from '@lib/programs/cull-feature-flags/seed';
import { buildCullOutro } from '@lib/programs/cull-feature-flags/outro';
import type { FlagScanResult } from '@lib/programs/cull-feature-flags/scan';
import type { CullCandidate } from '@lib/programs/cull-feature-flags/types';
import { OutroKind } from '@lib/wizard-session';

const STALE: CullCandidate = {
  key: 'new-checkout',
  bucket: 'fully-rolled-out',
  area: 'Rolled out',
  verdict: 'stale',
  proposedAction: 'keep on path, drop check, disable flag',
  reason: 'rollout 100%, ACTIVE',
  flagId: 42,
  flagName: 'New checkout',
  callSites: [
    {
      file: 'src/app/dashboard/page.tsx',
      line: 20,
      api: 'useFeatureFlagEnabled',
    },
    { file: 'src/lib/checkout.ts', line: 3, api: 'isFeatureEnabled' },
  ],
};

const HEALTHY: CullCandidate = {
  key: 'dark-mode',
  bucket: 'healthy',
  area: 'Healthy',
  verdict: 'healthy',
  proposedAction: 'keep',
  reason: 'rollout 30%, ACTIVE',
  flagId: 7,
  callSites: [
    { file: 'src/lib/flags.ts', line: 6, api: 'useFeatureFlagEnabled' },
  ],
};

const ORPHAN: CullCandidate = {
  key: 'pricing-v2-experiment',
  bucket: 'unreferenced',
  area: 'Unreferenced',
  verdict: 'stale',
  proposedAction: 'disable the flag',
  reason: 'rollout 50%, STALE',
  flagId: 9,
  callSites: [],
};

function scan(overrides: Partial<FlagScanResult> = {}): FlagScanResult {
  return {
    callSites: [],
    dynamicSites: [],
    mentionSites: [],
    usesBulkEvaluation: false,
    reachableFiles: [],
    filesScanned: 10,
    truncated: false,
    ...overrides,
  };
}

describe('candidateToCheck', () => {
  test('stale candidate becomes a pending row keyed by flag with bucket as area', () => {
    expect(candidateToCheck(STALE)).toEqual({
      id: 'new-checkout',
      area: 'Rolled out',
      label: 'new-checkout: keep on path, drop check, disable flag',
      status: 'pending',
      file: 'src/app/dashboard/page.tsx:20',
      details: 'rollout 100%, ACTIVE; also src/lib/checkout.ts:3',
    });
  });

  test('healthy candidate is seeded as pass, unreferenced candidate has no file', () => {
    expect(candidateToCheck(HEALTHY).status).toBe('pass');
    const orphan = candidateToCheck(ORPHAN);
    expect(orphan.file).toBeUndefined();
    expect(orphan.details).toBe('rollout 50%, STALE; no call sites');
  });
});

describe('buildCullPrompt', () => {
  test('names the ledger, counts per bucket, and the disable-only rule', () => {
    const prompt = buildCullPrompt({
      ledgerFile: '.posthog-audit-checks.json',
      candidates: [STALE, HEALTHY, ORPHAN],
      scan: scan(),
    });
    expect(prompt).toContain('./.posthog-audit-checks.json');
    expect(prompt).toContain('- Rolled out: 1');
    expect(prompt).toContain('- Healthy: 1');
    expect(prompt).toContain('- Unreferenced: 1');
    expect(prompt).toContain('never delete or archive');
    expect(prompt).not.toContain('getAllFlags');
  });

  test('adds the bulk, dynamic and truncation caveats when they apply', () => {
    const prompt = buildCullPrompt({
      ledgerFile: '.posthog-audit-checks.json',
      candidates: [ORPHAN],
      scan: scan({
        usesBulkEvaluation: true,
        dynamicSites: [
          { file: 'src/lib/flags.ts', line: 4, api: 'isFeatureEnabled' },
        ],
        truncated: true,
      }),
    });
    expect(prompt).toContain('calls getAllFlags');
    expect(prompt).toContain('src/lib/flags.ts:4 (isFeatureEnabled)');
    expect(prompt).toContain('hit its file limit');
  });
});

describe('buildCullOutro', () => {
  const common = {
    flagIdByKey: new Map([['new-checkout', 42]]),
    reportFile: 'posthog-feature-flag-cull-report.md',
    docsUrl: 'https://posthog.com/docs/feature-flags/best-practices',
  };

  test('nothing applied means a report-only message and no undo block', () => {
    const outro = buildCullOutro({
      ...common,
      checks: [
        {
          ...candidateToCheck(STALE),
          status: 'pass',
          details: 'x; declined by user',
        },
      ],
      touchedFiles: [],
    });
    expect(outro.kind).toBe(OutroKind.Success);
    expect(outro.message).toContain('Nothing was changed');
    expect(outro.changes).toEqual([]);
    expect(outro.nextSteps).toBeUndefined();
  });

  test('applied rows produce the git revert and a one-line PostHog undo', () => {
    const outro = buildCullOutro({
      ...common,
      checks: [
        { ...candidateToCheck(STALE), status: 'pass', details: 'x; applied' },
      ],
      touchedFiles: ['src/app/dashboard/page.tsx', 'src/lib/checkout.ts'],
    });
    expect(outro.message).toContain('Culled 1 feature flag.');
    expect(outro.changes).toEqual([candidateToCheck(STALE).label]);
    expect(outro.nextSteps).toEqual({
      heading: 'Undo, if you want it back:',
      items: [
        'Code: git checkout -- src/app/dashboard/page.tsx src/lib/checkout.ts (or git diff to review first)',
        'PostHog: 1 flag disabled, one toggle each to re-enable; the report links every flag page.',
      ],
    });
  });
});
