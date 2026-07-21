/**
 * Switchboard machinery tests: binding registry lockstep, precedence chains,
 * trace stamping, model capabilities, and structural clamps. Per-experiment
 * flag behavior and cross-program isolation live in one file per experiment
 * under `switchboard/flags/__tests__/`.
 *
 * Every resolution test is a BindingCase: (SwitchboardCtx in) → (full
 * four-axis resolveBinding out), optionally pinning the trace.
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
  SONNET_5_MODEL,
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
import { runBindingCases } from '@lib/agent/runner/switchboard/flags/__tests__/binding-cases';

const PROGRAM_IDS = PROGRAM_REGISTRY.map((c) => c.id);
const DEFAULT_RESOLVED = {
  sequence: Sequence.linear,
  harness: Harness.anthropic,
  model: DEFAULT_AGENT_MODEL,
  thinkingLevel: undefined,
} as const;

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
      if (program === 'ai-observability') continue; // pinned below
      expect(resolveBinding({ program, flags: {} })).toEqual(DEFAULT_RESOLVED);
    }
  });

  runBindingCases([
    {
      name: 'binds ai-observability to anthropic + sonnet 5',
      ctx: { program: 'ai-observability', flags: {} },
      binding: {
        sequence: Sequence.linear,
        harness: Harness.anthropic,
        model: SONNET_5_MODEL,
        thinkingLevel: undefined,
      },
      trace: { harness: 'binding', model: 'binding', sequence: 'binding' },
    },
    {
      name: 'falls back to DEFAULT_BINDING for an unmapped program',
      ctx: { program: 'not-a-program', flags: {} },
      binding: {
        sequence: DEFAULT_BINDING.sequence,
        harness: DEFAULT_BINDING.harness,
        model: DEFAULT_BINDING.model,
        thinkingLevel: undefined,
      },
      trace: { harness: 'binding', model: 'binding', sequence: 'binding' },
    },
  ]);
});

describe('switchboard CLI precedence (dev builds)', () => {
  runBindingCases([
    {
      name: 'cliHarness wins over the wizard-use-pi-harness flag',
      ctx: {
        program: 'posthog-integration',
        flags: { [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'false' },
        cliHarness: Harness.pi,
      },
      binding: { ...DEFAULT_RESOLVED, harness: Harness.pi },
      trace: { harness: 'cli', model: 'binding', sequence: 'binding' },
    },
    {
      name: 'cliModel wins over the flag pairing; the flag still routes the harness',
      ctx: {
        program: 'posthog-integration',
        flags: { [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'true' },
        cliModel: 'openai/o4-mini',
      },
      binding: {
        sequence: Sequence.linear,
        harness: Harness.pi,
        model: 'openai/o4-mini',
        thinkingLevel: undefined,
      },
      trace: { harness: 'flag', model: 'cli', sequence: 'binding' },
    },
    {
      name: 'cliHarness + cliModel pin both axes',
      ctx: {
        program: 'posthog-integration',
        flags: {},
        cliHarness: Harness.pi,
        cliModel: 'openai/gpt-5',
      },
      binding: {
        sequence: Sequence.linear,
        harness: Harness.pi,
        model: 'openai/gpt-5',
        thinkingLevel: undefined,
      },
      trace: { harness: 'cli', model: 'cli', sequence: 'binding' },
    },
    {
      name: 'cliModel alone leaves every other axis at the binding default',
      ctx: {
        program: 'posthog-integration',
        flags: {},
        cliModel: 'openai/gpt-5',
      },
      binding: { ...DEFAULT_RESOLVED, model: 'openai/gpt-5' },
      trace: { harness: 'binding', model: 'cli', sequence: 'binding' },
    },
  ]);
});

describe('switchboard decision trace', () => {
  runBindingCases([
    {
      name: 'nothing overrides → all axes traced to the binding',
      ctx: { program: 'posthog-integration', flags: {} },
      binding: DEFAULT_RESOLVED,
      trace: { harness: 'binding', model: 'binding', sequence: 'binding' },
    },
    {
      name: 'pi flag decides harness+model; sequence stays binding (pi has runTask, no clamp)',
      ctx: {
        program: 'posthog-integration',
        flags: { [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'true' },
      },
      binding: {
        sequence: Sequence.linear,
        harness: Harness.pi,
        model: GPT5_4_MODEL,
        thinkingLevel: undefined,
      },
      trace: { harness: 'flag', model: 'flag', sequence: 'binding' },
    },
    {
      name: 'both flags on → orchestrator on pi, every axis traced to its flag',
      ctx: {
        program: 'posthog-integration',
        flags: {
          [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'true',
          [WIZARD_ORCHESTRATOR_FLAG_KEY]: 'true',
        },
      },
      binding: {
        sequence: Sequence.orchestrator,
        harness: Harness.pi,
        model: GPT5_4_MODEL,
        thinkingLevel: undefined,
      },
      trace: { harness: 'flag', model: 'flag', sequence: 'flag' },
    },
  ]);
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
      // (sonnet 5 for ai-observability, the default elsewhere), and the
      // composed clamp holds the sequence at linear.
      expect(resolveBinding(ctx)).toEqual(
        program === 'ai-observability'
          ? { ...DEFAULT_RESOLVED, model: SONNET_5_MODEL }
          : DEFAULT_RESOLVED,
      );
      expect(ctx.trace?.sequence).toBe('composed');
    }
  });

  runBindingCases([
    {
      name: 'the dev CLI override cannot orchestrate a composed run either',
      ctx: {
        program: 'posthog-integration',
        composed: true,
        flags: {},
        cliSequence: Sequence.orchestrator,
      },
      binding: DEFAULT_RESOLVED,
      trace: { harness: 'binding', model: 'binding', sequence: 'composed' },
    },
    {
      name: 'a composed run keeps its flag-routed harness — only the sequence is clamped',
      ctx: {
        program: 'posthog-integration',
        composed: true,
        flags: {
          [WIZARD_USE_PI_HARNESS_FLAG_KEY]: 'true',
          [WIZARD_ORCHESTRATOR_FLAG_KEY]: 'true',
        },
      },
      binding: {
        sequence: Sequence.linear,
        harness: Harness.pi,
        model: GPT5_4_MODEL,
        thinkingLevel: undefined,
      },
      trace: { harness: 'flag', model: 'flag', sequence: 'composed' },
    },
  ]);
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
