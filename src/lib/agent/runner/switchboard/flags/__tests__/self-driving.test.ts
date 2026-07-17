/**
 * Self-driving pi experiment (wizard-self-driving-use-pi-harness, payload
 * `{model, effort?, harness?, sequence?}`). Routes ONLY `self-driving`; the
 * payload fails closed — anything unexpected keeps the non-flagged binding.
 *
 * Every test is (SwitchboardCtx in) → (full resolveBinding out): all four
 * axes asserted, so a payload can never move an axis these tests don't see.
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
const SD_ON = { [WIZARD_SELF_DRIVING_USE_PI_HARNESS_FLAG_KEY]: 'true' };
const sdPayload = (payload: unknown) => ({
  [WIZARD_SELF_DRIVING_USE_PI_HARNESS_FLAG_KEY]: payload,
});
const NON_FLAGGED = {
  sequence: Sequence.linear,
  harness: Harness.anthropic,
  model: DEFAULT_AGENT_MODEL,
  thinkingLevel: undefined,
};

const bind = (ctx: SwitchboardCtx) => resolveBinding(ctx);
const sdBind = (payload: unknown) =>
  bind({
    program: 'self-driving',
    flags: SD_ON,
    flagPayloads: sdPayload(payload),
  });

describe('self-driving experiment — scope declaration', () => {
  it('declares exactly the self-driving program, and it exists in the registry', () => {
    expect(SELF_DRIVING_EXPERIMENT.program).toBe('self-driving');
    expect(PROGRAM_IDS).toContain(SELF_DRIVING_EXPERIMENT.program);
  });
});

describe('self-driving experiment — payload in, binding out', () => {
  it('{model} routes to pi, linear, table-default effort', () => {
    expect(sdBind({ model: 'gpt-5-6-terra' })).toEqual({
      sequence: Sequence.linear,
      harness: Harness.pi,
      model: GPT5_6_TERRA_MODEL,
      thinkingLevel: undefined,
    });
  });

  it('{model, effort} adds the effort override', () => {
    expect(sdBind({ model: 'gpt-5-6-terra', effort: 'high' })).toEqual({
      sequence: Sequence.linear,
      harness: Harness.pi,
      model: GPT5_6_TERRA_MODEL,
      thinkingLevel: 'high',
    });
  });

  it('{model, harness} pins the harness axis', () => {
    expect(sdBind({ model: 'sonnet-5', harness: 'anthropic' })).toEqual({
      sequence: Sequence.linear,
      harness: Harness.anthropic,
      model: SONNET_5_MODEL,
      thinkingLevel: undefined,
    });
  });

  it('{model, sequence} pins the sequence axis — the ONLY orchestrator path for self-driving', () => {
    const ctx: SwitchboardCtx = {
      program: 'self-driving',
      flags: SD_ON,
      flagPayloads: sdPayload({
        model: 'gpt-5-6-terra',
        sequence: 'orchestrator',
      }),
    };
    expect(bind(ctx)).toEqual({
      sequence: Sequence.orchestrator,
      harness: Harness.pi,
      model: GPT5_6_TERRA_MODEL,
      thinkingLevel: undefined,
    });
    expect(ctx.trace?.sequence).toBe('flag');
  });

  it('a full payload pins every axis at once', () => {
    expect(
      sdBind({
        model: 'sonnet-5',
        effort: 'low',
        harness: 'anthropic',
        sequence: 'orchestrator',
      }),
    ).toEqual({
      sequence: Sequence.orchestrator,
      harness: Harness.anthropic,
      model: SONNET_5_MODEL,
      thinkingLevel: 'low',
    });
  });

  it('parses a JSON-string payload', () => {
    expect(sdBind('{"model": "gpt-5-4", "effort": "low"}')).toEqual({
      sequence: Sequence.linear,
      harness: Harness.pi,
      model: GPT5_4_MODEL,
      thinkingLevel: 'low',
    });
  });
});

describe('self-driving experiment — fail-closed payload', () => {
  it('any unexpected payload resolves to the non-flagged binding, whole shape', () => {
    expect(
      bind({ program: 'self-driving', flags: SD_ON }), // no payload at all
    ).toEqual(NON_FLAGGED);
    for (const payload of [
      undefined,
      '{not json',
      'gpt-5-4', // not an object
      ['gpt-5-4'],
      {}, // no model
      { model: 'banana' },
      { effort: 'high' },
      { model: 'gpt-5-4', effort: 'banana' },
      { model: 'gpt-5-4', harness: 'banana' },
      { model: 'gpt-5-4', sequence: 'banana' },
    ]) {
      expect(sdBind(payload)).toEqual(NON_FLAGGED);
    }
  });

  it('a rejected payload does not stamp flag sources on the trace', () => {
    const ctx: SwitchboardCtx = { program: 'self-driving', flags: SD_ON };
    resolveBinding(ctx);
    expect(ctx.trace).toEqual({
      harness: 'binding',
      model: 'binding',
      sequence: 'binding',
    });
  });

  it('is disabled on the cloud run surface even with a valid payload', () => {
    envState.runSurface = 'cloud';
    try {
      expect(sdBind({ model: 'gpt-5-6-terra', effort: 'high' })).toEqual(
        NON_FLAGGED,
      );
    } finally {
      envState.runSurface = 'local';
    }
  });
});

describe('self-driving experiment — isolation', () => {
  it('flag + maximal payload leave every other registry program exactly as unflagged', () => {
    const flagPayloads = sdPayload({
      model: 'gpt-5-4',
      effort: 'high',
      harness: 'pi',
      sequence: 'orchestrator',
    });
    for (const program of PROGRAM_IDS) {
      if (program === SELF_DRIVING_EXPERIMENT.program) continue;
      const ctx: SwitchboardCtx = { program, flags: SD_ON, flagPayloads };
      expect(bind(ctx)).toEqual(bind({ program, flags: {} }));
    }
  });

  it("other experiments' flags do not leak into a self-driving binding", () => {
    // The basic-integration effort flag is inert for a self-driving run.
    expect(
      bind({
        program: 'self-driving',
        flags: { ...SD_ON, [WIZARD_PI_EFFORT_FLAG_KEY]: 'high' },
        flagPayloads: sdPayload({ model: 'gpt-5-6-terra' }),
      }),
    ).toEqual({
      sequence: Sequence.linear,
      harness: Harness.pi,
      model: GPT5_6_TERRA_MODEL,
      thinkingLevel: undefined,
    });
  });
});
