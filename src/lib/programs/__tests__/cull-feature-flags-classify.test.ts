import { classifyFlags } from '@lib/programs/cull-feature-flags/classify';
import type { FlagScanResult } from '@lib/programs/cull-feature-flags/scan';
import type { FeatureFlag } from '@lib/programs/cull-feature-flags/types';

let nextFlagId = 1;

function flag(overrides: Partial<FeatureFlag> & { key: string }): FeatureFlag {
  return {
    id: nextFlagId++,
    active: true,
    archived: false,
    deleted: false,
    status: 'ACTIVE',
    filters: { groups: [{ rollout_percentage: 50, properties: [] }] },
    experiment_set: [],
    is_remote_configuration: false,
    has_encrypted_payloads: false,
    ...overrides,
  };
}

function rollout(percentage: number | null): FeatureFlag['filters'] {
  return { groups: [{ rollout_percentage: percentage, properties: [] }] };
}

function site(key: string, file: string, line = 1) {
  return { key, file, line, api: 'useFeatureFlagEnabled' };
}

function scan(overrides: Partial<FlagScanResult> = {}): FlagScanResult {
  return {
    callSites: [],
    dynamicSites: [],
    mentionSites: [],
    usesBulkEvaluation: false,
    reachableFiles: ['src/app/page.tsx', 'src/lib/flags.ts'],
    filesScanned: 2,
    truncated: false,
    ...overrides,
  };
}

function bucketOf(
  flags: FeatureFlag[],
  scanResult: FlagScanResult,
  key: string,
) {
  const match = classifyFlags(flags, scanResult).find((c) => c.key === key);
  return match ? [match.bucket, match.verdict] : undefined;
}

describe('classifyFlags', () => {
  test('fully rolled out flag with a call site is stale', () => {
    const flags = [flag({ key: 'new-checkout', filters: rollout(100) })];
    const result = scan({
      callSites: [site('new-checkout', 'src/app/page.tsx')],
    });
    expect(bucketOf(flags, result, 'new-checkout')).toEqual([
      'fully-rolled-out',
      'stale',
    ]);
  });

  test('rollout null counts as 100 percent', () => {
    const flags = [flag({ key: 'k', filters: rollout(null) })];
    const result = scan({ callSites: [site('k', 'src/app/page.tsx')] });
    expect(bucketOf(flags, result, 'k')).toEqual(['fully-rolled-out', 'stale']);
  });

  test('flag at 0% everywhere is stale but flagged as a possible rollback', () => {
    const flags = [flag({ key: 'beta-dashboard', filters: rollout(0) })];
    const result = scan({
      callSites: [site('beta-dashboard', 'src/app/page.tsx')],
    });
    expect(bucketOf(flags, result, 'beta-dashboard')).toEqual([
      'never-enabled',
      'stale',
    ]);
    const [candidate] = classifyFlags(flags, result);
    expect(candidate.area).toBe('Off for everyone');
    expect(candidate.reason).toContain('may be a rollback');
  });

  test('archived flag still referenced is stale, archived and unreferenced is skipped', () => {
    const flags = [
      flag({
        key: 'legacy-banner',
        active: false,
        archived: true,
        filters: rollout(100),
      }),
      flag({ key: 'gone', active: false, archived: true }),
    ];
    const result = scan({
      callSites: [site('legacy-banner', 'src/app/page.tsx')],
    });
    expect(bucketOf(flags, result, 'legacy-banner')).toEqual([
      'archived-still-referenced',
      'stale',
    ]);
    expect(bucketOf(flags, result, 'gone')).toBeUndefined();
  });

  test('disabled flag still referenced is stale', () => {
    const flags = [flag({ key: 'off', active: false })];
    const result = scan({ callSites: [site('off', 'src/app/page.tsx')] });
    expect(bucketOf(flags, result, 'off')).toEqual([
      'disabled-but-referenced',
      'stale',
    ]);
  });

  test('unreferenced flag is stale, comment-only mention is its own bucket', () => {
    const flags = [
      flag({ key: 'pricing-v2-experiment' }),
      flag({ key: 'holiday-promo' }),
    ];
    const result = scan({
      mentionSites: [
        { key: 'holiday-promo', file: 'src/app/page.tsx', line: 17 },
      ],
    });
    expect(bucketOf(flags, result, 'pricing-v2-experiment')).toEqual([
      'unreferenced',
      'stale',
    ]);
    expect(bucketOf(flags, result, 'holiday-promo')).toEqual([
      'unreferenced-comment-only',
      'stale',
    ]);
  });

  test('call site only in an unreachable file is dead code, even when fully rolled out', () => {
    const flags = [flag({ key: 'legacy-theme', filters: rollout(100) })];
    const result = scan({
      callSites: [site('legacy-theme', 'src/lib/unused/legacyTheme.ts')],
    });
    expect(bucketOf(flags, result, 'legacy-theme')).toEqual([
      'dead-code-reference',
      'stale',
    ]);
  });

  test('key evaluated in code with no PostHog flag is stale', () => {
    const result = scan({
      callSites: [site('old-pricing-test', 'src/app/page.tsx')],
    });
    const [only] = classifyFlags([], result);
    expect([only.bucket, only.verdict, only.flagId]).toEqual([
      'deleted-still-referenced',
      'stale',
      undefined,
    ]);
  });

  test('three or more files evaluating the same key directly is a warning', () => {
    const flags = [flag({ key: 'ai-assistant' })];
    const result = scan({
      callSites: [
        site('ai-assistant', 'src/app/page.tsx'),
        site('ai-assistant', 'src/components/A.tsx'),
        site('ai-assistant', 'src/components/B.tsx'),
      ],
      reachableFiles: [
        'src/app/page.tsx',
        'src/components/A.tsx',
        'src/components/B.tsx',
      ],
    });
    expect(bucketOf(flags, result, 'ai-assistant')).toEqual([
      'multi-callsite-no-wrapper',
      'warning',
    ]);
  });

  test('partial rollout and multivariate flags with call sites are healthy', () => {
    const flags = [
      flag({ key: 'dark-mode', filters: rollout(30) }),
      flag({
        key: 'signup-cta-variant',
        filters: {
          groups: [{ rollout_percentage: 100, properties: [] }],
          multivariate: { variants: [{ key: 'a' }, { key: 'b' }] },
        },
      }),
      flag({
        key: 'gated',
        filters: {
          groups: [{ rollout_percentage: 100, properties: [{ key: 'email' }] }],
        },
      }),
    ];
    const result = scan({
      callSites: [
        site('dark-mode', 'src/lib/flags.ts'),
        site('signup-cta-variant', 'src/app/page.tsx'),
        site('gated', 'src/app/page.tsx'),
      ],
    });
    expect(bucketOf(flags, result, 'dark-mode')).toEqual([
      'healthy',
      'healthy',
    ]);
    expect(bucketOf(flags, result, 'signup-cta-variant')).toEqual([
      'healthy',
      'healthy',
    ]);
    expect(bucketOf(flags, result, 'gated')).toEqual(['healthy', 'healthy']);
  });

  test('experiment, remote config and encrypted payload flags are guarded to healthy', () => {
    const flags = [
      flag({ key: 'exp', filters: rollout(100), experiment_set: [1] }),
      flag({ key: 'rc', filters: rollout(100), is_remote_configuration: true }),
      flag({ key: 'enc', filters: rollout(100), has_encrypted_payloads: true }),
    ];
    const result = scan({
      callSites: [
        site('exp', 'src/app/page.tsx'),
        site('rc', 'src/app/page.tsx'),
      ],
    });
    const byKey = Object.fromEntries(
      classifyFlags(flags, result).map((c) => [c.key, c]),
    );
    expect(byKey.exp.bucket).toBe('healthy');
    expect(byKey.exp.reason).toContain('backs an experiment');
    expect(byKey.rc.bucket).toBe('healthy');
    expect(byKey.enc.bucket).toBe('healthy');
  });

  test('deleted flags are ignored and candidates carry ledger-ready fields', () => {
    const flags = [
      flag({ key: 'zombie', deleted: true }),
      flag({
        key: 'new-checkout',
        name: 'New checkout',
        filters: rollout(100),
        status: 'ACTIVE',
      }),
    ];
    const result = scan({
      callSites: [site('new-checkout', 'src/app/page.tsx', 20)],
    });
    const candidates = classifyFlags(flags, result);
    expect(candidates.map((c) => c.key)).toEqual(['new-checkout']);
    expect(candidates[0]).toMatchObject({
      proposedAction: 'keep on path, drop check, disable flag',
      reason: 'rollout 100%, ACTIVE',
      flagName: 'New checkout',
      callSites: [
        { file: 'src/app/page.tsx', line: 20, api: 'useFeatureFlagEnabled' },
      ],
    });
  });
});
