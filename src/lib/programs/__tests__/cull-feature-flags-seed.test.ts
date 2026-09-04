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
  const ledgerFile = '.posthog-audit-checks.json';

  test('names the ledger and every area the candidates fall in', () => {
    const prompt = buildCullPrompt({
      ledgerFile,
      candidates: [STALE, HEALTHY, ORPHAN],
      scan: scan(),
    });
    expect(prompt).toContain(ledgerFile);
    expect(prompt).toContain('Rolled out');
    expect(prompt).toContain('Healthy');
    expect(prompt).toContain('Unreferenced');
  });

  test('dynamic key sites appear only when the scan found them', () => {
    const plain = buildCullPrompt({
      ledgerFile,
      candidates: [ORPHAN],
      scan: scan(),
    });
    const withCaveats = buildCullPrompt({
      ledgerFile,
      candidates: [ORPHAN],
      scan: scan({
        usesBulkEvaluation: true,
        dynamicSites: [
          { file: 'src/lib/flags.ts', line: 4, api: 'isFeatureEnabled' },
        ],
        truncated: true,
      }),
    });
    expect(plain).not.toContain('src/lib/flags.ts:4');
    expect(withCaveats).toContain('src/lib/flags.ts:4');
  });
});

describe('buildCullOutro', () => {
  const common = {
    flagIdByKey: new Map([['new-checkout', 42]]),
    installDir: '/srv/app',
    reportFile: 'posthog-feature-flag-cull-report.md',
    docsUrl: 'https://posthog.com/docs/feature-flags/best-practices',
  };

  test('nothing culled means no changes and no undo block', () => {
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
    expect(outro.message).toContain(
      '/srv/app/posthog-feature-flag-cull-report.md',
    );
    expect(outro.changes).toEqual([]);
    expect(outro.nextSteps).toBeUndefined();
  });

  test('culled rows list the change and an undo step for code and for PostHog', () => {
    const outro = buildCullOutro({
      ...common,
      checks: [
        { ...candidateToCheck(STALE), status: 'pass', details: 'x; culled' },
      ],
      touchedFiles: ['src/app/dashboard/page.tsx', 'src/lib/checkout.ts'],
    });
    expect(outro.message).toContain(
      '/srv/app/posthog-feature-flag-cull-report.md',
    );
    expect(outro.changes).toEqual([candidateToCheck(STALE).label]);
    const [codeUndo, posthogUndo] = outro.nextSteps?.items ?? [];
    expect(codeUndo).toContain('src/app/dashboard/page.tsx');
    expect(codeUndo).toContain('src/lib/checkout.ts');
    expect(posthogUndo).toBeDefined();
    expect(outro.nextSteps?.items).toHaveLength(2);
  });

  test('counts only culls that disabled a PostHog flag', () => {
    const outro = buildCullOutro({
      ...common,
      flagIdByKey: new Map([
        ['new-checkout', 42],
        ['archived-flag', 43],
      ]),
      checks: [
        { ...candidateToCheck(STALE), status: 'pass', details: 'x; culled' },
        {
          ...candidateToCheck(STALE),
          id: 'archived-flag',
          area: 'Archived in PostHog',
          status: 'pass',
          details: 'x; culled',
        },
        {
          ...candidateToCheck(STALE),
          id: 'deleted-flag',
          area: 'Deleted in PostHog',
          status: 'pass',
          details: 'x; culled',
        },
        {
          ...candidateToCheck(STALE),
          id: 'failed-flag',
          status: 'error',
          details: 'x; failed',
        },
        {
          ...candidateToCheck(STALE),
          id: 'declined-flag',
          status: 'pass',
          details: 'x; declined by user',
        },
      ],
      touchedFiles: ['src/app/dashboard/page.tsx'],
    });

    expect(outro.message).toContain('Culled 3 feature flags');
    expect(outro.message).toContain('1 failed');
    expect(outro.message).toContain('1 left for you');
    expect(outro.nextSteps?.items).toHaveLength(2);
    expect(outro.nextSteps?.items[1]).toContain('1 flag');
  });
});
