/**
 * Review-model experiment isolation (wizard-pi-model arm on the review role
 * of posthog-integration ONLY). This override runs runner-side — it outranks
 * prompt-frontmatter for its one role — so the scoping matrix cannot see it;
 * this file pins its scope and fail-closed behavior directly.
 */
import { describe, it, expect } from 'vitest';
import { PROGRAM_REGISTRY } from '@lib/programs/program-registry';
import {
  GPT5_6_SOL_MODEL,
  GPT5_6_TERRA_MODEL,
  WIZARD_PI_EFFORT_FLAG_KEY,
  WIZARD_PI_MODEL_FLAG_KEY,
  WIZARD_USE_PI_HARNESS_FLAG_KEY,
} from '@lib/constants';
import {
  REVIEW_MODEL_EXPERIMENT,
  reviewModelOverride,
} from '@lib/agent/runner/switchboard/flags/review-model';

const ARM_FLAGS = (variant: string, effort = 'medium') => ({
  [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'true',
  [WIZARD_PI_MODEL_FLAG_KEY]: variant,
  [WIZARD_PI_EFFORT_FLAG_KEY]: effort,
});

describe('review-model experiment — scope declaration', () => {
  it('declares the posthog-integration program (exists in the registry) and the review role', () => {
    expect(REVIEW_MODEL_EXPERIMENT.program).toBe('posthog-integration');
    expect(PROGRAM_REGISTRY.map((c) => c.id)).toContain(
      REVIEW_MODEL_EXPERIMENT.program,
    );
    expect(REVIEW_MODEL_EXPERIMENT.role).toBe('review');
  });

  it('declares exactly the sol and terra arms', () => {
    expect(REVIEW_MODEL_EXPERIMENT.arms).toEqual({
      'gpt-5-6-sol': GPT5_6_SOL_MODEL,
      'gpt-5-6-terra': GPT5_6_TERRA_MODEL,
    });
  });
});

describe('review-model experiment — arms route', () => {
  it.each([
    ['gpt-5-6-sol', GPT5_6_SOL_MODEL],
    ['gpt-5-6-terra', GPT5_6_TERRA_MODEL],
  ] as const)('%s → %s at medium', (variant, model) => {
    expect(
      reviewModelOverride('posthog-integration', 'review', ARM_FLAGS(variant)),
    ).toEqual({ model, effort: 'medium' });
  });

  it('invalid effort variant → model still routes, effort left to frontmatter', () => {
    expect(
      reviewModelOverride(
        'posthog-integration',
        'review',
        ARM_FLAGS('gpt-5-6-terra', 'banana'),
      ),
    ).toEqual({ model: GPT5_6_TERRA_MODEL, effort: undefined });
  });
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
    ['no flags at all', {}],
  ];
  it.each(cases)('%s → undefined, frontmatter stays', (_name, flags) => {
    expect(reviewModelOverride('posthog-integration', 'review', flags)).toBe(
      undefined,
    );
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
        reviewModelOverride(
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
        reviewModelOverride(program, 'review', ARM_FLAGS('gpt-5-6-terra')),
      ).toBe(undefined);
    }
  });
});
