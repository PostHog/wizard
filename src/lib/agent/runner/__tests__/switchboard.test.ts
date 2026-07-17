import { describe, it, expect, vi } from 'vitest';
import { PROGRAM_REGISTRY } from '@lib/programs/program-registry';
import {
  DEFAULT_AGENT_MODEL,
  SONNET_5_MODEL,
  GPT5_MINI_MODEL,
  GPT5_MODEL,
  GPT5_4_MODEL,
  GPT5_5_MODEL,
  GPT5_6_LUNA_MODEL,
  GPT5_6_SOL_MODEL,
  GPT5_6_TERRA_MODEL,
  Harness,
  WIZARD_PI_EFFORT_FLAG_KEY,
  WIZARD_PI_MODEL_FLAG_KEY,
  Sequence,
  WIZARD_ORCHESTRATOR_FLAG_KEY,
  WIZARD_SELF_DRIVING_USE_PI_HARNESS_FLAG_KEY,
  WIZARD_USE_PI_HARNESS_FLAG_KEY,
} from '@lib/constants';
import {
  PROGRAM_BINDINGS,
  DEFAULT_BINDING,
  resolveBinding,
  resolveHarness,
  resolveSequence,
  type SwitchboardCtx,
} from '@lib/agent/runner/switchboard';
import { modelCapabilities } from '@lib/agent/runner/switchboard/models';

// RUN_SURFACE is read live in flagRunnerOverride; a getter lets a test flip it.
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

describe('switchboard PROGRAM_BINDINGS', () => {
  // `ProgramId` widens to `string`, so the type can't force coverage. This is
  // the real guard: add a program without a binding and this fails.
  it('declares a binding for every registered program', () => {
    const missing = PROGRAM_IDS.filter((id) => !(id in PROGRAM_BINDINGS));
    expect(missing).toEqual([]);
  });

  it('maps no binding to an unregistered program', () => {
    const stale = Object.keys(PROGRAM_BINDINGS).filter(
      (id) => !PROGRAM_IDS.includes(id),
    );
    expect(stale).toEqual([]);
  });

  it('resolves every program to a registered harness and a non-empty model', () => {
    for (const program of PROGRAM_IDS) {
      const pick = resolveHarness({ program, flags: {} });
      expect(Object.values(Harness)).toContain(pick.harness);
      expect(pick.model).toBeTruthy();
    }
  });

  // Pins today's behavior: the seam changes nothing until a binding is moved.
  it('defaults every program to anthropic + DEFAULT_AGENT_MODEL', () => {
    for (const program of PROGRAM_IDS) {
      expect(resolveHarness({ program, flags: {} })).toEqual({
        harness: Harness.anthropic,
        model: DEFAULT_AGENT_MODEL,
      });
    }
  });

  it('falls back to DEFAULT_BINDING for an unmapped program', () => {
    expect(resolveHarness({ program: 'not-a-program', flags: {} })).toEqual({
      harness: DEFAULT_BINDING.harness,
      model: DEFAULT_BINDING.model,
    });
  });
});

describe('switchboard resolveHarness — CLI precedence', () => {
  it('CLI cliHarness wins over the wizard-use-pi-harness flag', () => {
    const pick = resolveHarness({
      program: 'posthog-integration',
      flags: { [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'false' },
      cliHarness: Harness.pi,
    });
    expect(pick.harness).toBe(Harness.pi);
  });

  it('the wizard-use-pi-harness flag overlays when no CLI is set', () => {
    const pick = resolveHarness({
      program: 'posthog-integration',
      flags: { [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'true' },
    });
    expect(pick.harness).toBe(Harness.pi);
  });

  it('the pi flag pairs pi with gpt-5.4; off keeps anthropic + sonnet', () => {
    expect(
      resolveHarness({
        program: 'posthog-integration',
        flags: { [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'true' },
      }),
    ).toEqual({ harness: Harness.pi, model: GPT5_4_MODEL });
    expect(
      resolveHarness({
        program: 'posthog-integration',
        flags: { [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'false' },
      }),
    ).toEqual({ harness: Harness.anthropic, model: DEFAULT_AGENT_MODEL });
  });

  it('a --model override still wins over the pi flag pairing', () => {
    const pick = resolveHarness({
      program: 'posthog-integration',
      flags: { [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'true' },
      cliModel: 'openai/o4-mini',
    });
    expect(pick).toEqual({ harness: Harness.pi, model: 'openai/o4-mini' });
  });

  it('the wizard-pi-model variant selects the model; unknown falls back to gpt-5.4', () => {
    const base = { [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'true' };
    const pick = (variant?: string) =>
      resolveHarness({
        program: 'posthog-integration',
        flags: variant
          ? { ...base, [WIZARD_PI_MODEL_FLAG_KEY]: variant }
          : base,
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

  it('a non-"true" flag value falls back to the binding default', () => {
    const pick = resolveHarness({
      program: 'posthog-integration',
      flags: { [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'banana' },
    });
    expect(pick.harness).toBe(Harness.anthropic);
  });

  it('CLI cliModel overlays the binding model, independent of harness', () => {
    const pick = resolveHarness({
      program: 'posthog-integration',
      flags: {},
      cliHarness: Harness.pi,
      cliModel: 'openai/gpt-5',
    });
    expect(pick).toEqual({ harness: Harness.pi, model: 'openai/gpt-5' });
  });

  it('cliModel alone leaves the harness at the binding default', () => {
    const pick = resolveHarness({
      program: 'posthog-integration',
      flags: {},
      cliModel: 'openai/gpt-5',
    });
    expect(pick).toEqual({ harness: Harness.anthropic, model: 'openai/gpt-5' });
  });
});

describe('switchboard resolveHarness — pi flag is gated to posthog-integration', () => {
  it('honours the pi flag for posthog-integration', () => {
    const pick = resolveHarness({
      program: 'posthog-integration',
      flags: { [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'true' },
    });
    expect(pick).toEqual({ harness: Harness.pi, model: GPT5_4_MODEL });
  });

  it('disables the pi flag on the cloud run surface, even for posthog-integration', () => {
    envState.runSurface = 'cloud';
    try {
      const pick = resolveHarness({
        program: 'posthog-integration',
        flags: { [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'true' },
      });
      expect(pick).toEqual({
        harness: Harness.anthropic,
        model: DEFAULT_AGENT_MODEL,
      });
    } finally {
      envState.runSurface = 'local';
    }
  });

  it('keeps the pi flag on the local run surface for posthog-integration', () => {
    const pick = resolveHarness({
      program: 'posthog-integration',
      flags: { [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'true' },
    });
    expect(pick.harness).toBe(Harness.pi);
  });

  it('ignores the pi flag for self-driving — stays on the anthropic default', () => {
    const pick = resolveHarness({
      program: 'self-driving',
      flags: { [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'true' },
    });
    expect(pick).toEqual({
      harness: Harness.anthropic,
      model: DEFAULT_AGENT_MODEL,
    });
  });

  it('ignores the pi flag for every non-posthog-integration program', () => {
    for (const program of PROGRAM_IDS) {
      if (program === 'posthog-integration') continue;
      expect(
        resolveHarness({
          program,
          flags: { [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'true' },
        }).harness,
      ).toBe(Harness.anthropic);
    }
  });

  it('leaves the sequence unclamped for a gated program (pi never selected)', () => {
    const ctx: SwitchboardCtx = {
      program: 'self-driving',
      flags: { [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'true' },
    };
    resolveBinding(ctx);
    expect(ctx.trace).toEqual({
      harness: 'binding',
      model: 'binding',
      sequence: 'binding',
    });
  });
});

describe('switchboard resolveHarness — self-driving pi payload flag', () => {
  const SD_ON = { [WIZARD_SELF_DRIVING_USE_PI_HARNESS_FLAG_KEY]: 'true' };
  const sdPayload = (payload: unknown) => ({
    [WIZARD_SELF_DRIVING_USE_PI_HARNESS_FLAG_KEY]: payload,
  });
  const NON_FLAGGED = {
    harness: Harness.anthropic,
    model: DEFAULT_AGENT_MODEL,
  };

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

  it('fails closed to the non-flagged default on any unexpected payload', () => {
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

  it('payload harness/sequence override their axes when present', () => {
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
    // Sequence in the payload pins the sequence axis without the global flag.
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
    const binding = resolveBinding(ctx);
    expect(binding).toEqual({
      sequence: Sequence.orchestrator,
      harness: Harness.anthropic,
      model: SONNET_5_MODEL,
      thinkingLevel: 'low',
    });
    expect(ctx.trace?.sequence).toBe('flag');
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

  it('parses a JSON-string payload', () => {
    const pick = resolveHarness({
      program: 'self-driving',
      flags: SD_ON,
      flagPayloads: sdPayload('{"model": "gpt-5-4", "effort": "low"}'),
    });
    expect(pick.model).toBe(GPT5_4_MODEL);
    expect(pick.thinkingLevel).toBe('low');
  });

  it('ignores the self-driving flag for posthog-integration — configs do not cross', () => {
    const pick = resolveHarness({
      program: 'posthog-integration',
      flags: SD_ON,
      flagPayloads: sdPayload({ model: 'gpt-5-4', effort: 'high' }),
    });
    expect(pick).toEqual(NON_FLAGGED);
    // The integration effort flag is inert for a self-driving run.
    expect(
      resolveHarness({
        program: 'self-driving',
        flags: { ...SD_ON, [WIZARD_PI_EFFORT_FLAG_KEY]: 'high' },
        flagPayloads: sdPayload({ model: 'gpt-5-6-terra' }),
      }).thinkingLevel,
    ).toBeUndefined();
  });

  it('disables the self-driving flag on the cloud run surface', () => {
    envState.runSurface = 'cloud';
    try {
      const pick = resolveHarness({
        program: 'self-driving',
        flags: SD_ON,
        flagPayloads: sdPayload({ model: 'gpt-5-6-terra', effort: 'high' }),
      });
      expect(pick).toEqual(NON_FLAGGED);
    } finally {
      envState.runSurface = 'local';
    }
  });

  it('ignores the global orchestrator flag — context-mill has no self-driving seed prompt', () => {
    const ctx: SwitchboardCtx = {
      program: 'self-driving',
      flags: { ...SD_ON, [WIZARD_ORCHESTRATOR_FLAG_KEY]: 'true' },
      flagPayloads: sdPayload({ model: 'gpt-5-6-terra', effort: 'high' }),
    };
    const binding = resolveBinding(ctx);
    // The resolved effort rides the binding (telemetry reads it from here).
    expect(binding).toEqual({
      sequence: Sequence.linear,
      harness: Harness.pi,
      model: GPT5_6_TERRA_MODEL,
      thinkingLevel: 'high',
    });
    expect(ctx.trace).toEqual({
      harness: 'flag',
      model: 'flag',
      sequence: 'binding',
    });
  });
});

describe('switchboard decision trace', () => {
  it('stamps binding sources when nothing overrides', () => {
    const ctx: SwitchboardCtx = { program: 'posthog-integration', flags: {} };
    resolveBinding(ctx);
    expect(ctx.trace).toEqual({
      harness: 'binding',
      model: 'binding',
      sequence: 'binding',
    });
  });

  it('stamps flag + binding sources when the pi flag decides (pi has runTask, no clamp)', () => {
    const ctx: SwitchboardCtx = {
      program: 'posthog-integration',
      flags: { [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'true' },
    };
    resolveBinding(ctx);
    expect(ctx.trace).toEqual({
      harness: 'flag',
      model: 'flag',
      sequence: 'binding',
    });
  });

  it('runs the orchestrator on pi when both flags are on', () => {
    const ctx: SwitchboardCtx = {
      program: 'posthog-integration',
      flags: {
        [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'true',
        [WIZARD_ORCHESTRATOR_FLAG_KEY]: 'true',
      },
    };
    const binding = resolveBinding(ctx);
    expect(binding.harness).toBe(Harness.pi);
    expect(binding.sequence).toBe(Sequence.orchestrator);
    expect(ctx.trace?.sequence).toBe('flag');
  });

  it('stamps cli sources over the flag', () => {
    const ctx: SwitchboardCtx = {
      program: 'posthog-integration',
      flags: { [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'true' },
      cliHarness: Harness.anthropic,
      cliModel: 'openai/gpt-5',
    };
    resolveBinding(ctx);
    expect(ctx.trace).toEqual({
      harness: 'cli',
      model: 'cli',
      sequence: 'binding',
    });
  });

  it('stamps flag source when the orchestrator flag decides the sequence', () => {
    const ctx: SwitchboardCtx = {
      program: 'posthog-integration',
      flags: { [WIZARD_ORCHESTRATOR_FLAG_KEY]: 'true' },
    };
    resolveBinding(ctx);
    expect(ctx.trace?.sequence).toBe('flag');
  });
});

describe('switchboard modelCapabilities', () => {
  it('marks the known reasoning models as reasoning', () => {
    for (const m of [
      'claude-sonnet-4-6',
      'claude-opus-4-8',
      'claude-haiku-4-5-20251001',
      'openai/gpt-5',
    ]) {
      expect(modelCapabilities(m).reasoning).toBe(true);
    }
  });

  it('defaults a non-reasoning openai model (gpt-4o) to no reasoning', () => {
    // The bug that no-op'd gpt-4o: reasoning:true → reasoning_effort → gateway
    // UnsupportedParamsError.
    expect(modelCapabilities('openai/gpt-4o').reasoning).toBe(false);
  });

  it('sets reasoning effort per model: gpt-5 low (fast flagship), gpt-5-mini medium', () => {
    expect(modelCapabilities(GPT5_MODEL).thinkingLevel).toBe('low');
    expect(modelCapabilities(GPT5_MINI_MODEL).thinkingLevel).toBe('medium');
    // The gpt-5.6 line + gpt-5.5 are reasoning models despite the openai/ prefix; they opt in past the default-off.
    for (const m of [
      GPT5_6_LUNA_MODEL,
      GPT5_6_TERRA_MODEL,
      GPT5_6_SOL_MODEL,
      GPT5_5_MODEL,
    ]) {
      expect(modelCapabilities(m).reasoning).toBe(true);
    }
    // luna/sol/5.5 stay low (fast); terra runs medium as the sonnet-tier parallel.
    expect(modelCapabilities(GPT5_6_LUNA_MODEL).thinkingLevel).toBe('low');
    expect(modelCapabilities(GPT5_6_TERRA_MODEL).thinkingLevel).toBe('medium');
    expect(modelCapabilities(GPT5_6_SOL_MODEL).thinkingLevel).toBe('low');
    expect(modelCapabilities(GPT5_5_MODEL).thinkingLevel).toBe('low');
    // Anthropic default carries no explicit effort — the harness default stands.
    expect(
      modelCapabilities(DEFAULT_AGENT_MODEL).thinkingLevel,
    ).toBeUndefined();
  });

  it('defaults unknown models by transport: anthropic on, openai off', () => {
    expect(modelCapabilities('claude-future-9').reasoning).toBe(true);
    expect(modelCapabilities('openai/whatever').reasoning).toBe(false);
  });
});

describe('switchboard wizard-pi-effort flag', () => {
  const PI_ON = { [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'true' };
  const pickLevel = (flags: Record<string, string>) =>
    resolveHarness({ program: 'posthog-integration', flags }).thinkingLevel;

  it('resolves a valid effort variant onto the pick; ignores invalid', () => {
    expect(pickLevel({ ...PI_ON, [WIZARD_PI_EFFORT_FLAG_KEY]: 'high' })).toBe(
      'high',
    );
    expect(
      pickLevel({ ...PI_ON, [WIZARD_PI_EFFORT_FLAG_KEY]: 'banana' }),
    ).toBeUndefined();
  });

  it('the override rides only a reasoning model — dropped for non-reasoning', () => {
    expect(modelCapabilities(GPT5_4_MODEL, 'high').thinkingLevel).toBe('high');
    expect(modelCapabilities(GPT5_4_MODEL).thinkingLevel).toBe('low');
    expect(
      modelCapabilities('openai/gpt-4o', 'high').thinkingLevel,
    ).toBeUndefined();
  });

  it('is inert unless the pi-harness flag is on — effort cannot ride a non-pi pick', () => {
    expect(pickLevel({ [WIZARD_PI_EFFORT_FLAG_KEY]: 'high' })).toBeUndefined();
  });

  it('is inert on the cloud surface even with the pi flag on', () => {
    envState.runSurface = 'cloud';
    try {
      expect(
        pickLevel({ ...PI_ON, [WIZARD_PI_EFFORT_FLAG_KEY]: 'high' }),
      ).toBeUndefined();
    } finally {
      envState.runSurface = 'local';
    }
  });
});

describe('switchboard resolveSequence — orchestrator stays flag-gated', () => {
  it('defaults to linear with no CLI override and no flag', () => {
    expect(resolveSequence({ program: 'posthog-integration', flags: {} })).toBe(
      Sequence.linear,
    );
  });

  it('the wizard-orchestrator flag selects orchestrator', () => {
    expect(
      resolveSequence({
        program: 'posthog-integration',
        flags: { [WIZARD_ORCHESTRATOR_FLAG_KEY]: 'true' },
      }),
    ).toBe(Sequence.orchestrator);
  });

  it('CLI cliSequence wins over the flag', () => {
    expect(
      resolveSequence({
        program: 'posthog-integration',
        flags: { [WIZARD_ORCHESTRATOR_FLAG_KEY]: 'true' },
        cliSequence: Sequence.linear,
      }),
    ).toBe(Sequence.linear);
  });

  it('a non-"true" flag value stays linear', () => {
    expect(
      resolveSequence({
        program: 'posthog-integration',
        flags: { [WIZARD_ORCHESTRATOR_FLAG_KEY]: 'linear' },
      }),
    ).toBe(Sequence.linear);
  });
});
