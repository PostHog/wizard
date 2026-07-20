/**
 * Basic-integration pi experiment (wizard-use-pi-harness + wizard-pi-model +
 * wizard-pi-effort). Routes ONLY `posthog-integration`.
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
import { runBindingCases, type BindingCase } from './binding-cases';

const envState = vi.hoisted(() => ({
  runSurface: 'local' as 'cloud' | 'local',
}));
vi.mock('@env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@env')>()),
  get RUN_SURFACE() {
    return envState.runSurface;
  },
}));
const setSurface = (s: 'cloud' | 'local') => (envState.runSurface = s);

const PROGRAM_IDS = PROGRAM_REGISTRY.map((c) => c.id);

/** ctx for a posthog-integration run with the given trio flag values. */
const integration = (flags: Record<string, string>): BindingCase['ctx'] => ({
  program: 'posthog-integration',
  flags,
});
const PI_ON = { [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'true' };
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
} as const;
const PI_LINEAR = (model: string, thinkingLevel?: 'high') => ({
  sequence: Sequence.linear,
  harness: Harness.pi,
  model,
  thinkingLevel,
});

describe('basic-integration experiment — scope declaration', () => {
  it('declares exactly the posthog-integration program, and it exists in the registry', () => {
    expect(BASIC_INTEGRATION_EXPERIMENT.program).toBe('posthog-integration');
    expect(PROGRAM_IDS).toContain(BASIC_INTEGRATION_EXPERIMENT.program);
  });
});

describe('basic-integration experiment — flags in, binding out', () => {
  runBindingCases(
    [
      {
        name: 'use flag alone → pi + gpt-5.4, linear, table-default effort',
        ctx: integration(PI_ON),
        binding: PI_LINEAR(GPT5_4_MODEL),
        trace: { harness: 'flag', model: 'flag', sequence: 'binding' },
      },
      {
        name: 'full trio → pi + selected model + effort override, still linear',
        ctx: integration(TRIO_ON),
        binding: PI_LINEAR(GPT5_4_MODEL, 'high'),
      },
      {
        name: "use flag 'false' → the non-flagged binding, whole shape",
        ctx: integration({ [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'false' }),
        binding: NON_FLAGGED,
      },
      {
        name: "use flag garbage ('banana') → the non-flagged binding",
        ctx: integration({ [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'banana' }),
        binding: NON_FLAGGED,
      },
      {
        name: 'invalid effort variant → table default, pi routing intact',
        ctx: integration({ ...PI_ON, [WIZARD_PI_EFFORT_FLAG_KEY]: 'banana' }),
        binding: PI_LINEAR(GPT5_4_MODEL),
      },
      {
        name: 'effort flag without the use flag → inert, non-flagged binding',
        ctx: integration({ [WIZARD_PI_EFFORT_FLAG_KEY]: 'high' }),
        binding: NON_FLAGGED,
      },
      {
        name: 'cloud surface → experiment disabled, trio and all',
        surface: 'cloud',
        ctx: integration(TRIO_ON),
        binding: NON_FLAGGED,
      },
    ],
    setSurface,
  );

  // Variant key → gateway model, unknown/missing → gpt-5.4 fallback.
  runBindingCases(
    (
      [
        ['gpt-5', GPT5_MODEL],
        ['gpt-5-4', GPT5_4_MODEL],
        ['gpt-5-mini', GPT5_MINI_MODEL],
        ['gpt-5-6-luna', GPT5_6_LUNA_MODEL],
        ['gpt-5-6-terra', GPT5_6_TERRA_MODEL],
        ['gpt-5-6-sol', GPT5_6_SOL_MODEL],
        ['gpt-5-5', GPT5_5_MODEL],
        ['sonnet-4-6', DEFAULT_AGENT_MODEL],
        ['sonnet-5', SONNET_5_MODEL],
        ['banana', GPT5_4_MODEL],
        [undefined, GPT5_4_MODEL],
      ] as const
    ).map(([variant, model]) => ({
      name: `model variant ${variant ?? '(missing)'} → ${model}`,
      ctx: integration(
        variant ? { ...PI_ON, [WIZARD_PI_MODEL_FLAG_KEY]: variant } : PI_ON,
      ),
      binding: PI_LINEAR(model),
    })),
  );
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
