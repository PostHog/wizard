/**
 * Basic-integration pi experiment (wizard-use-pi-harness + wizard-pi-model +
 * wizard-pi-effort). Routes ONLY `posthog-integration`.
 *
 * Every test is (SwitchboardCtx in) → (full resolveBinding out): all four
 * axes asserted, so a flag can never move an axis these tests don't look at.
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
  Sequence,
  SONNET_5_MODEL,
  WIZARD_PI_EFFORT_FLAG_KEY,
  WIZARD_PI_MODEL_FLAG_KEY,
  WIZARD_USE_PI_HARNESS_FLAG_KEY,
} from '@lib/constants';
import {
  resolveBinding,
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
  sequence: Sequence.linear,
  harness: Harness.anthropic,
  model: DEFAULT_AGENT_MODEL,
  thinkingLevel: undefined,
};

const bind = (ctx: SwitchboardCtx) => resolveBinding(ctx);

describe('basic-integration experiment — scope declaration', () => {
  it('declares exactly the posthog-integration program, and it exists in the registry', () => {
    expect(BASIC_INTEGRATION_EXPERIMENT.program).toBe('posthog-integration');
    expect(PROGRAM_IDS).toContain(BASIC_INTEGRATION_EXPERIMENT.program);
  });
});

describe('basic-integration experiment — flags in, binding out', () => {
  it('the use flag alone: pi + gpt-5.4, linear, table-default effort', () => {
    expect(bind({ program: 'posthog-integration', flags: PI_ON })).toEqual({
      sequence: Sequence.linear,
      harness: Harness.pi,
      model: GPT5_4_MODEL,
      thinkingLevel: undefined,
    });
  });

  it('the full trio: pi + selected model + effort override, still linear', () => {
    expect(bind({ program: 'posthog-integration', flags: TRIO_ON })).toEqual({
      sequence: Sequence.linear,
      harness: Harness.pi,
      model: GPT5_4_MODEL,
      thinkingLevel: 'high',
    });
  });

  it('use flag off or garbage: the non-flagged binding, whole shape', () => {
    for (const value of ['false', 'banana', '']) {
      expect(
        bind({
          program: 'posthog-integration',
          flags: { [WIZARD_USE_PI_HARNESS_FLAG_KEY]: value },
        }),
      ).toEqual(NON_FLAGGED);
    }
  });

  it('the model variant selects the model; unknown/missing falls back to gpt-5.4', () => {
    const model = (variant?: string) =>
      bind({
        program: 'posthog-integration',
        flags: variant
          ? { ...PI_ON, [WIZARD_PI_MODEL_FLAG_KEY]: variant }
          : PI_ON,
      }).model;
    expect(model('gpt-5')).toBe(GPT5_MODEL);
    expect(model('gpt-5-4')).toBe(GPT5_4_MODEL);
    expect(model('gpt-5-mini')).toBe(GPT5_MINI_MODEL);
    expect(model('gpt-5-6-luna')).toBe(GPT5_6_LUNA_MODEL);
    expect(model('gpt-5-6-terra')).toBe(GPT5_6_TERRA_MODEL);
    expect(model('gpt-5-6-sol')).toBe(GPT5_6_SOL_MODEL);
    expect(model('gpt-5-5')).toBe(GPT5_5_MODEL);
    expect(model('sonnet-4-6')).toBe(DEFAULT_AGENT_MODEL);
    expect(model('sonnet-5')).toBe(SONNET_5_MODEL);
    expect(model('banana')).toBe(GPT5_4_MODEL);
    expect(model()).toBe(GPT5_4_MODEL);
  });

  it('an invalid effort variant keeps the table default; effort without the use flag is inert', () => {
    expect(
      bind({
        program: 'posthog-integration',
        flags: { ...PI_ON, [WIZARD_PI_EFFORT_FLAG_KEY]: 'banana' },
      }),
    ).toEqual({
      sequence: Sequence.linear,
      harness: Harness.pi,
      model: GPT5_4_MODEL,
      thinkingLevel: undefined,
    });
    expect(
      bind({
        program: 'posthog-integration',
        flags: { [WIZARD_PI_EFFORT_FLAG_KEY]: 'high' },
      }),
    ).toEqual(NON_FLAGGED);
  });

  it('is disabled on the cloud run surface, trio and all', () => {
    envState.runSurface = 'cloud';
    try {
      expect(bind({ program: 'posthog-integration', flags: TRIO_ON })).toEqual(
        NON_FLAGGED,
      );
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
      expect(bind(ctx)).toEqual(bind({ program, flags: {} }));
      expect(ctx.trace).toEqual({
        harness: 'binding',
        model: 'binding',
        sequence: 'binding',
      });
    }
  });
});
