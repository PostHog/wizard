/**
 * Basic-integration pi experiment (wizard-use-pi-harness + wizard-pi-model +
 * wizard-pi-effort). Routes ONLY `posthog-integration`; every test here is
 * about this experiment's behavior and its isolation from other programs.
 */
import { describe, it, expect, vi } from 'vitest';
import { PROGRAM_REGISTRY } from '@lib/programs/program-registry';
import {
  DEFAULT_AGENT_MODEL,
  GPT5_4_MODEL,
  GPT5_5_MODEL,
  GPT5_6_LUNA_MODEL,
  GPT5_6_SOL_MODEL,
  GPT5_6_TERRA_MODEL,
  GPT5_MINI_MODEL,
  GPT5_MODEL,
  Harness,
  SONNET_5_MODEL,
  WIZARD_PI_EFFORT_FLAG_KEY,
  WIZARD_PI_MODEL_FLAG_KEY,
  WIZARD_USE_PI_HARNESS_FLAG_KEY,
} from '@lib/constants';
import {
  resolveBinding,
  resolveHarness,
  type SwitchboardCtx,
} from '@lib/agent/runner/switchboard';
import { BASIC_INTEGRATION_EXPERIMENT } from '@lib/agent/runner/switchboard/flags/basic-integration';

// RUN_SURFACE is read live in the flag resolver; a getter lets a test flip it.
const envState = vi.hoisted(() => ({
  runSurface: 'local' as 'cloud' | 'local',
}));
vi.mock('@env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@env')>()),
  get RUN_SURFACE() {
    return envState.runSurface;
  },
}));

const PROGRAM_IDS = PROGRAM_REGISTRY.map((c) => c.id);
const PI_ON = { [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'true' };
/** The full trio forced on — the strongest routing this experiment can assert. */
const TRIO_ON = {
  ...PI_ON,
  [WIZARD_PI_MODEL_FLAG_KEY]: 'gpt-5-4',
  [WIZARD_PI_EFFORT_FLAG_KEY]: 'high',
};
const NON_FLAGGED = {
  harness: Harness.anthropic,
  model: DEFAULT_AGENT_MODEL,
};

describe('basic-integration experiment — scope declaration', () => {
  it('declares exactly the posthog-integration program, and it exists in the registry', () => {
    expect(BASIC_INTEGRATION_EXPERIMENT.program).toBe('posthog-integration');
    expect(PROGRAM_IDS).toContain(BASIC_INTEGRATION_EXPERIMENT.program);
  });
});

describe('basic-integration experiment — routing', () => {
  it('the use flag pairs pi with gpt-5.4; off keeps the binding default', () => {
    expect(
      resolveHarness({ program: 'posthog-integration', flags: PI_ON }),
    ).toEqual({ harness: Harness.pi, model: GPT5_4_MODEL });
    expect(
      resolveHarness({
        program: 'posthog-integration',
        flags: { [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'false' },
      }),
    ).toEqual(NON_FLAGGED);
  });

  it('a non-"true" use-flag value falls back to the binding default', () => {
    expect(
      resolveHarness({
        program: 'posthog-integration',
        flags: { [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'banana' },
      }),
    ).toEqual(NON_FLAGGED);
  });

  it('the model variant selects the model; unknown/missing falls back to gpt-5.4', () => {
    const pick = (variant?: string) =>
      resolveHarness({
        program: 'posthog-integration',
        flags: variant
          ? { ...PI_ON, [WIZARD_PI_MODEL_FLAG_KEY]: variant }
          : PI_ON,
      }).model;
    expect(pick('gpt-5')).toBe(GPT5_MODEL);
    expect(pick('gpt-5-4')).toBe(GPT5_4_MODEL);
    expect(pick('gpt-5-mini')).toBe(GPT5_MINI_MODEL);
    expect(pick('gpt-5-6-luna')).toBe(GPT5_6_LUNA_MODEL);
    expect(pick('gpt-5-6-terra')).toBe(GPT5_6_TERRA_MODEL);
    expect(pick('gpt-5-6-sol')).toBe(GPT5_6_SOL_MODEL);
    expect(pick('gpt-5-5')).toBe(GPT5_5_MODEL);
    expect(pick('sonnet-4-6')).toBe(DEFAULT_AGENT_MODEL);
    expect(pick('sonnet-5')).toBe(SONNET_5_MODEL);
    expect(pick('banana')).toBe(GPT5_4_MODEL);
    expect(pick()).toBe(GPT5_4_MODEL);
  });

  it('resolves a valid effort variant onto the pick; ignores invalid', () => {
    const pickLevel = (flags: Record<string, string>) =>
      resolveHarness({ program: 'posthog-integration', flags }).thinkingLevel;
    expect(pickLevel({ ...PI_ON, [WIZARD_PI_EFFORT_FLAG_KEY]: 'high' })).toBe(
      'high',
    );
    expect(
      pickLevel({ ...PI_ON, [WIZARD_PI_EFFORT_FLAG_KEY]: 'banana' }),
    ).toBeUndefined();
    // Effort cannot ride a non-pi pick: inert unless the use flag is on.
    expect(pickLevel({ [WIZARD_PI_EFFORT_FLAG_KEY]: 'high' })).toBeUndefined();
  });

  it('is disabled on the cloud run surface, trio and all', () => {
    envState.runSurface = 'cloud';
    try {
      const pick = resolveHarness({
        program: 'posthog-integration',
        flags: TRIO_ON,
      });
      expect(pick).toEqual(NON_FLAGGED);
    } finally {
      envState.runSurface = 'local';
    }
  });
});

describe('basic-integration experiment — isolation', () => {
  it('the full trio leaves every other registry program exactly as unflagged', () => {
    for (const program of PROGRAM_IDS) {
      if (program === BASIC_INTEGRATION_EXPERIMENT.program) continue;
      const ctx: SwitchboardCtx = { program, flags: TRIO_ON };
      expect(resolveBinding(ctx)).toEqual(
        resolveBinding({ program, flags: {} }),
      );
      expect(ctx.trace).toEqual({
        harness: 'binding',
        model: 'binding',
        sequence: 'binding',
      });
    }
  });
});
