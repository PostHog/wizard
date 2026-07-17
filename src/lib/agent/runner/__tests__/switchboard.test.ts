/**
 * Switchboard machinery tests: binding registry lockstep, precedence chains,
 * trace stamping, model capabilities, and structural clamps. Per-experiment
 * flag behavior and cross-program isolation live in one file per experiment
 * under `switchboard/flags/__tests__/`.
 *
 * Every resolution test is (SwitchboardCtx in) → (full resolveBinding out).
 * `modelCapabilities` is the second pure stage (effective effort) and is
 * asserted directly.
 */
import { describe, it, expect } from 'vitest';
import { PROGRAM_REGISTRY } from '@lib/programs/program-registry';
import {
  DEFAULT_AGENT_MODEL,
  GPT5_MINI_MODEL,
  GPT5_MODEL,
  GPT5_4_MODEL,
  GPT5_5_MODEL,
  GPT5_6_LUNA_MODEL,
  GPT5_6_SOL_MODEL,
  GPT5_6_TERRA_MODEL,
  Harness,
  Sequence,
  WIZARD_ORCHESTRATOR_FLAG_KEY,
  WIZARD_USE_PI_HARNESS_FLAG_KEY,
} from '@lib/constants';
import {
  PROGRAM_BINDINGS,
  DEFAULT_BINDING,
  resolveBinding,
  type SwitchboardCtx,
} from '@lib/agent/runner/switchboard';
import { modelCapabilities } from '@lib/agent/runner/switchboard/models';

const PROGRAM_IDS = PROGRAM_REGISTRY.map((c) => c.id);
const bind = (ctx: SwitchboardCtx) => resolveBinding(ctx);
const DEFAULT_RESOLVED = {
  sequence: Sequence.linear,
  harness: Harness.anthropic,
  model: DEFAULT_AGENT_MODEL,
  thinkingLevel: undefined,
};

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

  // Pins today's behavior: the seam changes nothing until a binding is moved.
  it('resolves every program, unflagged, to the same default binding', () => {
    for (const program of PROGRAM_IDS) {
      expect(bind({ program, flags: {} })).toEqual(DEFAULT_RESOLVED);
    }
  });

  it('falls back to DEFAULT_BINDING for an unmapped program', () => {
    expect(bind({ program: 'not-a-program', flags: {} })).toEqual({
      sequence: DEFAULT_BINDING.sequence,
      harness: DEFAULT_BINDING.harness,
      model: DEFAULT_BINDING.model,
      thinkingLevel: undefined,
    });
  });
});

describe('switchboard CLI precedence (dev builds)', () => {
  it('cliHarness wins over the wizard-use-pi-harness flag', () => {
    expect(
      bind({
        program: 'posthog-integration',
        flags: { [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'false' },
        cliHarness: Harness.pi,
      }),
    ).toEqual({ ...DEFAULT_RESOLVED, harness: Harness.pi });
  });

  it('cliModel wins over the flag pairing; the flag still routes the harness', () => {
    expect(
      bind({
        program: 'posthog-integration',
        flags: { [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'true' },
        cliModel: 'openai/o4-mini',
      }),
    ).toEqual({
      sequence: Sequence.linear,
      harness: Harness.pi,
      model: 'openai/o4-mini',
      thinkingLevel: undefined,
    });
  });

  it('cliHarness + cliModel pin both axes', () => {
    expect(
      bind({
        program: 'posthog-integration',
        flags: {},
        cliHarness: Harness.pi,
        cliModel: 'openai/gpt-5',
      }),
    ).toEqual({
      sequence: Sequence.linear,
      harness: Harness.pi,
      model: 'openai/gpt-5',
      thinkingLevel: undefined,
    });
  });

  it('cliModel alone leaves every other axis at the binding default', () => {
    expect(
      bind({
        program: 'posthog-integration',
        flags: {},
        cliModel: 'openai/gpt-5',
      }),
    ).toEqual({ ...DEFAULT_RESOLVED, model: 'openai/gpt-5' });
  });
});

describe('switchboard decision trace', () => {
  it('stamps binding sources when nothing overrides', () => {
    const ctx: SwitchboardCtx = { program: 'posthog-integration', flags: {} };
    bind(ctx);
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
    bind(ctx);
    expect(ctx.trace).toEqual({
      harness: 'flag',
      model: 'flag',
      sequence: 'binding',
    });
  });

  it('both flags on: orchestrator on pi, sequence traced to the flag', () => {
    const ctx: SwitchboardCtx = {
      program: 'posthog-integration',
      flags: {
        [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'true',
        [WIZARD_ORCHESTRATOR_FLAG_KEY]: 'true',
      },
    };
    expect(bind(ctx)).toEqual({
      sequence: Sequence.orchestrator,
      harness: Harness.pi,
      model: GPT5_4_MODEL,
      thinkingLevel: undefined,
    });
    expect(ctx.trace).toEqual({
      harness: 'flag',
      model: 'flag',
      sequence: 'flag',
    });
  });

  it('stamps cli sources over the flag', () => {
    const ctx: SwitchboardCtx = {
      program: 'posthog-integration',
      flags: { [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'true' },
      cliHarness: Harness.anthropic,
      cliModel: 'openai/gpt-5',
    };
    bind(ctx);
    expect(ctx.trace).toEqual({
      harness: 'cli',
      model: 'cli',
      sequence: 'binding',
    });
  });
});

describe('switchboard composed clamp', () => {
  it('a composed sub-run is linear for every program, whatever the flags say', () => {
    for (const program of PROGRAM_IDS) {
      const ctx: SwitchboardCtx = {
        program,
        composed: true,
        flags: { [WIZARD_ORCHESTRATOR_FLAG_KEY]: 'true' },
        trace: {},
      };
      // Only the orchestrator flag is on → harness/model stay at the binding
      // default, and the composed clamp holds the sequence at linear.
      expect(bind(ctx)).toEqual(DEFAULT_RESOLVED);
      expect(ctx.trace?.sequence).toBe('composed');
    }
  });

  it('the dev CLI override cannot orchestrate a composed run either', () => {
    expect(
      bind({
        program: 'posthog-integration',
        composed: true,
        flags: {},
        cliSequence: Sequence.orchestrator,
      }),
    ).toEqual(DEFAULT_RESOLVED);
  });

  it('a composed run keeps its flag-routed harness — only the sequence is clamped', () => {
    const ctx: SwitchboardCtx = {
      program: 'posthog-integration',
      composed: true,
      flags: {
        [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'true',
        [WIZARD_ORCHESTRATOR_FLAG_KEY]: 'true',
      },
    };
    expect(bind(ctx)).toEqual({
      sequence: Sequence.linear,
      harness: Harness.pi,
      model: GPT5_4_MODEL,
      thinkingLevel: undefined,
    });
  });
});

describe('switchboard modelCapabilities (stage 2: effective effort)', () => {
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

  it('a binding thinkingLevel override rides only a reasoning model', () => {
    expect(modelCapabilities(GPT5_4_MODEL, 'high').thinkingLevel).toBe('high');
    expect(modelCapabilities(GPT5_4_MODEL).thinkingLevel).toBe('low');
    expect(
      modelCapabilities('openai/gpt-4o', 'high').thinkingLevel,
    ).toBeUndefined();
  });
});
