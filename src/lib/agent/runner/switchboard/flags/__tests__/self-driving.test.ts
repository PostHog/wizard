/**
 * Self-driving pi experiment (wizard-self-driving-use-pi-harness, payload
 * `{model, effort?, harness?, sequence?}`). Routes ONLY `self-driving`;
 * anything unexpected fails closed to the non-flagged binding.
 */
import { describe, it, expect, vi } from 'vitest';
import { PROGRAM_REGISTRY } from '@lib/programs/program-registry';
import {
  DEFAULT_AGENT_MODEL,
  GPT5_4_MODEL,
  GPT5_6_TERRA_MODEL,
  Harness,
  Sequence,
  SONNET_5_MODEL,
  WIZARD_PI_EFFORT_FLAG_KEY,
  WIZARD_SELF_DRIVING_USE_PI_HARNESS_FLAG_KEY,
} from '@lib/constants';
import {
  resolveBinding,
  type SwitchboardCtx,
} from '@lib/agent/runner/switchboard';
import { SELF_DRIVING_EXPERIMENT } from '@lib/agent/runner/switchboard/flags/self-driving';
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
const SD_FLAG = WIZARD_SELF_DRIVING_USE_PI_HARNESS_FLAG_KEY;

/** ctx for a self-driving run with the flag on and the given payload. */
const sd = (payload?: unknown): BindingCase['ctx'] => ({
  program: 'self-driving',
  flags: { [SD_FLAG]: 'true' },
  ...(payload === undefined ? {} : { flagPayloads: { [SD_FLAG]: payload } }),
});

const NON_FLAGGED = {
  sequence: Sequence.linear,
  harness: Harness.anthropic,
  model: DEFAULT_AGENT_MODEL,
  thinkingLevel: undefined,
} as const;

describe('self-driving experiment — scope declaration', () => {
  it('declares exactly the self-driving program, and it exists in the registry', () => {
    expect(SELF_DRIVING_EXPERIMENT.program).toBe('self-driving');
    expect(PROGRAM_IDS).toContain(SELF_DRIVING_EXPERIMENT.program);
  });
});

describe('self-driving experiment — payload in, binding out', () => {
  runBindingCases(
    [
      {
        name: '{model} → pi, linear, table-default effort',
        ctx: sd({ model: 'gpt-5-6-terra' }),
        binding: {
          sequence: Sequence.linear,
          harness: Harness.pi,
          model: GPT5_6_TERRA_MODEL,
          thinkingLevel: undefined,
        },
      },
      {
        name: '{model, effort} → adds the effort override',
        ctx: sd({ model: 'gpt-5-6-terra', effort: 'high' }),
        binding: {
          sequence: Sequence.linear,
          harness: Harness.pi,
          model: GPT5_6_TERRA_MODEL,
          thinkingLevel: 'high',
        },
        trace: { harness: 'flag', model: 'flag', sequence: 'binding' },
      },
      {
        name: '{model, harness} → pins the harness axis',
        ctx: sd({ model: 'sonnet-5', harness: 'anthropic' }),
        binding: {
          sequence: Sequence.linear,
          harness: Harness.anthropic,
          model: SONNET_5_MODEL,
          thinkingLevel: undefined,
        },
      },
      {
        name: "{model, sequence} → pins the sequence axis (self-driving's ONLY orchestrator path)",
        ctx: sd({ model: 'gpt-5-6-terra', sequence: 'orchestrator' }),
        binding: {
          sequence: Sequence.orchestrator,
          harness: Harness.pi,
          model: GPT5_6_TERRA_MODEL,
          thinkingLevel: undefined,
        },
        // 'payload' (the program's own route) vs 'flag' (a sequence
        // experiment) — telemetry can tell which flag moved the sequence.
        trace: { harness: 'flag', model: 'flag', sequence: 'payload' },
      },
      {
        name: 'full payload → pins every axis at once',
        ctx: sd({
          model: 'sonnet-5',
          effort: 'low',
          harness: 'anthropic',
          sequence: 'orchestrator',
        }),
        binding: {
          sequence: Sequence.orchestrator,
          harness: Harness.anthropic,
          model: SONNET_5_MODEL,
          thinkingLevel: 'low',
        },
      },
      {
        name: 'JSON-string payload parses',
        ctx: sd('{"model": "gpt-5-4", "effort": "low"}'),
        binding: {
          sequence: Sequence.linear,
          harness: Harness.pi,
          model: GPT5_4_MODEL,
          thinkingLevel: 'low',
        },
      },
      {
        name: 'valid payload on the cloud surface → experiment disabled',
        surface: 'cloud',
        ctx: sd({ model: 'gpt-5-6-terra', effort: 'high' }),
        binding: NON_FLAGGED,
      },
    ],
    setSurface,
  );
});

describe('self-driving experiment — fail-closed payload', () => {
  runBindingCases([
    { name: 'no payload at all', ctx: sd(), binding: NON_FLAGGED },
    {
      name: 'unparseable JSON string',
      ctx: sd('{not json'),
      binding: NON_FLAGGED,
    },
    { name: 'not an object', ctx: sd('gpt-5-4'), binding: NON_FLAGGED },
    { name: 'an array', ctx: sd(['gpt-5-4']), binding: NON_FLAGGED },
    { name: 'empty object (no model)', ctx: sd({}), binding: NON_FLAGGED },
    {
      name: 'unknown model',
      ctx: sd({ model: 'banana' }),
      binding: NON_FLAGGED,
    },
    {
      name: 'effort without model',
      ctx: sd({ effort: 'high' }),
      binding: NON_FLAGGED,
    },
    {
      name: 'invalid effort rejects the whole payload',
      ctx: sd({ model: 'gpt-5-4', effort: 'banana' }),
      binding: NON_FLAGGED,
    },
    {
      name: 'invalid harness rejects the whole payload',
      ctx: sd({ model: 'gpt-5-4', harness: 'banana' }),
      binding: NON_FLAGGED,
    },
    {
      name: 'invalid sequence rejects the whole payload',
      ctx: sd({ model: 'gpt-5-4', sequence: 'banana' }),
      binding: NON_FLAGGED,
    },
  ]);

  it('a rejected payload does not stamp flag sources on the trace', () => {
    const ctx: SwitchboardCtx = { ...sd() };
    resolveBinding(ctx);
    expect(ctx.trace).toEqual({
      harness: 'binding',
      model: 'binding',
      sequence: 'binding',
    });
  });
});

describe('self-driving experiment — isolation', () => {
  it('flag + maximal payload leave every other registry program exactly as unflagged', () => {
    const flagged = sd({
      model: 'gpt-5-4',
      effort: 'high',
      harness: 'pi',
      sequence: 'orchestrator',
    });
    for (const program of PROGRAM_IDS) {
      if (program === SELF_DRIVING_EXPERIMENT.program) continue;
      expect(resolveBinding({ ...flagged, program })).toEqual(
        resolveBinding({ program, flags: {} }),
      );
    }
  });

  runBindingCases([
    {
      name: "other experiments' flags do not leak into a self-driving binding",
      ctx: {
        ...sd({ model: 'gpt-5-6-terra' }),
        flags: { [SD_FLAG]: 'true', [WIZARD_PI_EFFORT_FLAG_KEY]: 'high' },
      },
      binding: {
        sequence: Sequence.linear,
        harness: Harness.pi,
        model: GPT5_6_TERRA_MODEL,
        thinkingLevel: undefined,
      },
    },
  ]);
});
