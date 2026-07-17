/**
 * Self-driving pi experiment (wizard-self-driving-use-pi-harness, payload
 * `{model, effort?, harness?, sequence?}`). Routes ONLY `self-driving`; the
 * payload fails closed — anything unexpected keeps the non-flagged binding
 * default (anthropic, linear).
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
  resolveHarness,
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
  harness: Harness.anthropic,
  model: DEFAULT_AGENT_MODEL,
};

describe('self-driving experiment — scope declaration', () => {
  it('declares exactly the self-driving program, and it exists in the registry', () => {
    expect(SELF_DRIVING_EXPERIMENT.program).toBe('self-driving');
    expect(PROGRAM_IDS).toContain(SELF_DRIVING_EXPERIMENT.program);
  });
});

describe('self-driving experiment — payload routing', () => {
  it('routes self-driving to pi when the flag is on with a valid payload', () => {
    const pick = (model: string, effort?: string) =>
      resolveHarness({
        program: 'self-driving',
        flags: SD_ON,
        flagPayloads: sdPayload({ model, effort }),
      });
    expect(pick('gpt-5-6-terra', 'high')).toEqual({
      harness: Harness.pi,
      model: GPT5_6_TERRA_MODEL,
      thinkingLevel: 'high',
    });
    expect(pick('gpt-5-4').model).toBe(GPT5_4_MODEL);
    expect(pick('sonnet-5').model).toBe(SONNET_5_MODEL);
    // Effort is optional — absent keeps the model table default.
    expect(pick('gpt-5-6-terra').thinkingLevel).toBeUndefined();
  });

  it('parses a JSON-string payload', () => {
    const pick = resolveHarness({
      program: 'self-driving',
      flags: SD_ON,
      flagPayloads: sdPayload('{"model": "gpt-5-4", "effort": "low"}'),
    });
    expect(pick.model).toBe(GPT5_4_MODEL);
    expect(pick.thinkingLevel).toBe('low');
  });

  it('payload harness/sequence pin their axes when present', () => {
    // Harness in the payload wins over the pi default.
    expect(
      resolveHarness({
        program: 'self-driving',
        flags: SD_ON,
        flagPayloads: sdPayload({ model: 'sonnet-5', harness: 'anthropic' }),
      }),
    ).toEqual({
      harness: Harness.anthropic,
      model: SONNET_5_MODEL,
      thinkingLevel: undefined,
    });
    // Sequence in the payload is the ONLY way self-driving enters the orchestrator.
    const ctx: SwitchboardCtx = {
      program: 'self-driving',
      flags: SD_ON,
      flagPayloads: sdPayload({
        model: 'gpt-5-6-terra',
        sequence: 'orchestrator',
      }),
    };
    const binding = resolveBinding(ctx);
    expect(binding.sequence).toBe(Sequence.orchestrator);
    expect(ctx.trace?.sequence).toBe('flag');
  });

  it('a full payload can pin every axis at once', () => {
    const ctx: SwitchboardCtx = {
      program: 'self-driving',
      flags: SD_ON,
      flagPayloads: sdPayload({
        model: 'sonnet-5',
        effort: 'low',
        harness: 'anthropic',
        sequence: 'orchestrator',
      }),
    };
    expect(resolveBinding(ctx)).toEqual({
      sequence: Sequence.orchestrator,
      harness: Harness.anthropic,
      model: SONNET_5_MODEL,
      thinkingLevel: 'low',
    });
    expect(ctx.trace?.sequence).toBe('flag');
  });
});

describe('self-driving experiment — fail-closed payload', () => {
  it('falls back to the non-flagged default on any unexpected payload', () => {
    const pick = (flagPayloads?: Record<string, unknown>) =>
      resolveHarness({ program: 'self-driving', flags: SD_ON, flagPayloads });
    expect(pick()).toEqual(NON_FLAGGED); // no payload at all
    expect(pick(sdPayload(undefined))).toEqual(NON_FLAGGED);
    expect(pick(sdPayload('{not json'))).toEqual(NON_FLAGGED);
    expect(pick(sdPayload('gpt-5-4'))).toEqual(NON_FLAGGED); // not an object
    expect(pick(sdPayload(['gpt-5-4']))).toEqual(NON_FLAGGED);
    expect(pick(sdPayload({}))).toEqual(NON_FLAGGED); // no model
    expect(pick(sdPayload({ model: 'banana' }))).toEqual(NON_FLAGGED);
    expect(pick(sdPayload({ effort: 'high' }))).toEqual(NON_FLAGGED);
    expect(pick(sdPayload({ model: 'gpt-5-4', effort: 'banana' }))).toEqual(
      NON_FLAGGED,
    );
    expect(pick(sdPayload({ model: 'gpt-5-4', harness: 'banana' }))).toEqual(
      NON_FLAGGED,
    );
    expect(pick(sdPayload({ model: 'gpt-5-4', sequence: 'banana' }))).toEqual(
      NON_FLAGGED,
    );
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
      expect(
        resolveHarness({
          program: 'self-driving',
          flags: SD_ON,
          flagPayloads: sdPayload({ model: 'gpt-5-6-terra', effort: 'high' }),
        }),
      ).toEqual(NON_FLAGGED);
    } finally {
      envState.runSurface = 'local';
    }
  });
});

describe('self-driving experiment — isolation', () => {
  it('flag + payload leave every other registry program exactly as unflagged', () => {
    const flagPayloads = sdPayload({
      model: 'gpt-5-4',
      effort: 'high',
      harness: 'pi',
      sequence: 'orchestrator',
    });
    for (const program of PROGRAM_IDS) {
      if (program === SELF_DRIVING_EXPERIMENT.program) continue;
      const ctx: SwitchboardCtx = { program, flags: SD_ON, flagPayloads };
      expect(resolveBinding(ctx)).toEqual(
        resolveBinding({ program, flags: {} }),
      );
    }
  });

  it("other experiments' flags do not leak into a self-driving pick", () => {
    // The basic-integration effort flag is inert for a self-driving run.
    expect(
      resolveHarness({
        program: 'self-driving',
        flags: { ...SD_ON, [WIZARD_PI_EFFORT_FLAG_KEY]: 'high' },
        flagPayloads: sdPayload({ model: 'gpt-5-6-terra' }),
      }).thinkingLevel,
    ).toBeUndefined();
  });
});
