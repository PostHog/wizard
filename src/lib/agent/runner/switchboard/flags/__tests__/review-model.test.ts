/** Review-model experiment isolation — the role route runs runner-side, invisible to the scoping matrix, so its scope and fail-closed behavior are pinned here. */
import { describe, it, expect, vi } from 'vitest';
import { PROGRAM_REGISTRY } from '@lib/programs/program-registry';
import {
  GPT5_6_SOL_MODEL,
  GPT5_6_TERRA_MODEL,
  WIZARD_PI_EFFORT_FLAG_KEY,
  WIZARD_PI_MODEL_FLAG_KEY,
  WIZARD_USE_PI_HARNESS_FLAG_KEY,
} from '@lib/constants';
import {
  ROLE_EXPERIMENTS,
  resolveRoleRoute,
} from '@lib/agent/runner/switchboard/flags';
import { REVIEW_MODEL_EXPERIMENT } from '@lib/agent/runner/switchboard/flags/review-model';

const envState = vi.hoisted(() => ({
  runSurface: 'local' as 'cloud' | 'local',
}));
vi.mock('@env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@env')>()),
  get RUN_SURFACE() {
    return envState.runSurface;
  },
}));

const ARM_FLAGS = (variant: string, effort?: string) => ({
  [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'true',
  [WIZARD_PI_MODEL_FLAG_KEY]: variant,
  ...(effort ? { [WIZARD_PI_EFFORT_FLAG_KEY]: effort } : {}),
});

describe('review-model experiment — scope declaration', () => {
  it('is the only registered role experiment', () => {
    expect(ROLE_EXPERIMENTS).toEqual([REVIEW_MODEL_EXPERIMENT]);
  });

  it('declares the posthog-integration program (exists in the registry), the review role, the effort flag, and exactly the sol/terra arms', () => {
    expect(REVIEW_MODEL_EXPERIMENT.program).toBe('posthog-integration');
    expect(PROGRAM_REGISTRY.map((c) => c.id)).toContain(
      REVIEW_MODEL_EXPERIMENT.program,
    );
    expect(REVIEW_MODEL_EXPERIMENT.role).toBe('review');
    expect(REVIEW_MODEL_EXPERIMENT.effortFlag).toBe(WIZARD_PI_EFFORT_FLAG_KEY);
    expect(REVIEW_MODEL_EXPERIMENT.arms).toEqual([
      'gpt-5-6-sol',
      'gpt-5-6-terra',
    ]);
  });
});

describe('review-model experiment — arms route', () => {
  it.each([
    ['gpt-5-6-sol', GPT5_6_SOL_MODEL],
    ['gpt-5-6-terra', GPT5_6_TERRA_MODEL],
  ] as const)('%s + effort flag medium → %s at medium', (variant, model) => {
    expect(
      resolveRoleRoute(
        'posthog-integration',
        'review',
        ARM_FLAGS(variant, 'medium'),
      ),
    ).toEqual({ model, effort: 'medium' });
  });

  it('the effort flag rides the arm (high → high)', () => {
    expect(
      resolveRoleRoute(
        'posthog-integration',
        'review',
        ARM_FLAGS('gpt-5-6-sol', 'high'),
      ),
    ).toEqual({ model: GPT5_6_SOL_MODEL, effort: 'high' });
  });

  it.each([
    ['missing', undefined],
    ['invalid (banana)', 'banana'],
  ])(
    'effort flag %s → effort undefined, the frontmatter effort governs',
    (_name, effort) => {
      expect(
        resolveRoleRoute(
          'posthog-integration',
          'review',
          ARM_FLAGS('gpt-5-6-terra', effort),
        ),
      ).toEqual({ model: GPT5_6_TERRA_MODEL, effort: undefined });
    },
  );
});

describe('review-model experiment — fail closed', () => {
  const cases: Array<[string, Record<string, string>]> = [
    ['use flag off', { [WIZARD_PI_MODEL_FLAG_KEY]: 'gpt-5-6-terra' }],
    [
      "use flag garbage ('banana')",
      {
        [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'banana',
        [WIZARD_PI_MODEL_FLAG_KEY]: 'gpt-5-6-terra',
      },
    ],
    ['model variant missing', { [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'true' }],
    ['non-arm variant (luna)', ARM_FLAGS('gpt-5-6-luna')],
    ['unknown variant', ARM_FLAGS('banana')],
    ['prototype-key variant (__proto__)', ARM_FLAGS('__proto__')],
    ['prototype-key variant (constructor)', ARM_FLAGS('constructor')],
    ['no flags at all', {}],
  ];
  it.each(cases)('%s → undefined, frontmatter stays', (_name, flags) => {
    expect(resolveRoleRoute('posthog-integration', 'review', flags)).toBe(
      undefined,
    );
  });

  it('cloud surface → undefined, arms on full (same gate as the harness experiments)', () => {
    envState.runSurface = 'cloud';
    try {
      expect(
        resolveRoleRoute(
          'posthog-integration',
          'review',
          ARM_FLAGS('gpt-5-6-terra'),
        ),
      ).toBe(undefined);
    } finally {
      envState.runSurface = 'local';
    }
  });
});

describe('review-model experiment — isolation', () => {
  it('every other role of the orchestrator flow is untouched, arms on full', () => {
    for (const role of [
      'seed',
      'install',
      'init',
      'identify',
      'error-tracking',
      'capture',
      'dashboard',
      'report',
      'default',
    ]) {
      expect(
        resolveRoleRoute(
          'posthog-integration',
          role,
          ARM_FLAGS('gpt-5-6-terra'),
        ),
      ).toBe(undefined);
    }
  });

  it('every other registry program is untouched, even for a review role', () => {
    for (const program of PROGRAM_REGISTRY.map((c) => c.id)) {
      if (program === REVIEW_MODEL_EXPERIMENT.program) continue;
      expect(
        resolveRoleRoute(program, 'review', ARM_FLAGS('gpt-5-6-terra')),
      ).toBe(undefined);
    }
  });
});
