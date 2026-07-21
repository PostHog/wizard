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
      if (program === 'ai-observability') continue; // pinned below
      expect(resolveHarness({ program, flags: {} })).toEqual({
        harness: Harness.anthropic,
        model: DEFAULT_AGENT_MODEL,
      });
    }
  });

  it('binds ai-observability to anthropic + sonnet 5', () => {
    expect(resolveHarness({ program: 'ai-observability', flags: {} })).toEqual({
      harness: Harness.anthropic,
      model: SONNET_5_MODEL,
    });
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

  it('overrides effort for reasoning models; ignores invalid; skips non-reasoning', () => {
    expect(
      modelCapabilities(GPT5_4_MODEL, {
        ...PI_ON,
        [WIZARD_PI_EFFORT_FLAG_KEY]: 'high',
      }).thinkingLevel,
    ).toBe('high');
    expect(
      modelCapabilities(GPT5_4_MODEL, {
        ...PI_ON,
        [WIZARD_PI_EFFORT_FLAG_KEY]: 'banana',
      }).thinkingLevel,
    ).toBe('low');
    expect(
      modelCapabilities('openai/gpt-4o', {
        ...PI_ON,
        [WIZARD_PI_EFFORT_FLAG_KEY]: 'high',
      }).thinkingLevel,
    ).toBeUndefined();
  });

  it('is inert unless the pi-harness flag is on — effort cannot ride a non-pi pick', () => {
    // Effort set but the pi flag off: the override is ignored, so the model's
    // own table effort stands (gpt-5.4 → low) and anthropic keeps no effort.
    expect(
      modelCapabilities(GPT5_4_MODEL, { [WIZARD_PI_EFFORT_FLAG_KEY]: 'high' })
        .thinkingLevel,
    ).toBe('low');
    expect(
      modelCapabilities(DEFAULT_AGENT_MODEL, {
        [WIZARD_PI_EFFORT_FLAG_KEY]: 'high',
      }).thinkingLevel,
    ).toBeUndefined();
  });

  it('is inert on the cloud surface even with the pi flag on', () => {
    envState.runSurface = 'cloud';
    try {
      expect(
        modelCapabilities(GPT5_4_MODEL, {
          [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'true',
          [WIZARD_PI_EFFORT_FLAG_KEY]: 'high',
        }).thinkingLevel,
      ).toBe('low');
    } finally {
      envState.runSurface = 'local';
    }
  });

  it('opts out with applyEffortFlag:false — orchestrator tasks keep the table effort', () => {
    // The flag is a linear-run knob; a per-task agent ignores it and keeps its
    // own tuned level (terra medium), even with the flag set to high.
    expect(
      modelCapabilities(
        GPT5_6_TERRA_MODEL,
        { ...PI_ON, [WIZARD_PI_EFFORT_FLAG_KEY]: 'high' },
        { applyEffortFlag: false },
      ).thinkingLevel,
    ).toBe('medium');
    expect(
      modelCapabilities(
        GPT5_6_LUNA_MODEL,
        { ...PI_ON, [WIZARD_PI_EFFORT_FLAG_KEY]: 'high' },
        { applyEffortFlag: false },
      ).thinkingLevel,
    ).toBe('low');
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
