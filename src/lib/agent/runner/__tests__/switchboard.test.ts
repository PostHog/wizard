import { describe, it, expect } from 'vitest';
import { PROGRAM_REGISTRY } from '@lib/programs/program-registry';
import {
  DEFAULT_AGENT_MODEL,
  GPT5_MINI_MODEL,
  GPT5_MODEL,
  Harness,
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

  it('the pi flag pairs pi with gpt-5-mini; off keeps anthropic + sonnet', () => {
    expect(
      resolveHarness({
        program: 'posthog-integration',
        flags: { [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'true' },
      }),
    ).toEqual({ harness: Harness.pi, model: GPT5_MINI_MODEL });
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

  it('stamps flag + pi-clamp sources when the pi flag decides', () => {
    const ctx: SwitchboardCtx = {
      program: 'posthog-integration',
      flags: { [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'true' },
    };
    resolveBinding(ctx);
    expect(ctx.trace).toEqual({
      harness: 'flag',
      model: 'flag',
      sequence: 'pi-clamp',
    });
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
