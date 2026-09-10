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
  GPT5_6_LUNA_MODEL,
  GPT5_6_SOL_MODEL,
  GPT5_6_TERRA_MODEL,
  HAIKU_MODEL,
  SONNET_5_MODEL,
  Harness,
  Sequence,
  WIZARD_ORCHESTRATOR_FLAG_KEY,
} from '@lib/constants';
import {
  PROGRAM_BINDINGS,
  DEFAULT_BINDING,
  resolveBinding,
  type SwitchboardCtx,
} from '@lib/agent/runner/switchboard';
import {
  modelCapabilities,
  MINT_ALLOWED_EFFORTS,
  isValidModel,
  requireKnownModel,
  TRIAGE_MODELS,
  VALID_MODELS,
} from '@lib/agent/runner/switchboard/models';
import { runBindingCases } from '@lib/agent/runner/switchboard/flags/__tests__/binding-cases';

const PROGRAM_IDS = PROGRAM_REGISTRY.map((c) => c.id);
const DEFAULT_RESOLVED = {
  sequence: Sequence.linear,
  harness: Harness.pi,
  model: GPT5_6_SOL_MODEL,
  thinkingLevel: 'medium',
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
      if (program === 'error-tracking-upload-source-maps') continue; // pinned below
      if (program === 'metrics') continue; // pinned below
      if (program === 'replay-vision') continue; // pinned below
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
      name: 'binds source-map uploads to pi + sol medium',
      ctx: { program: 'error-tracking-upload-source-maps', flags: {} },
      binding: {
        sequence: Sequence.linear,
        harness: Harness.pi,
        model: GPT5_6_SOL_MODEL,
        thinkingLevel: 'medium',
      },
      trace: { harness: 'binding', model: 'binding', sequence: 'binding' },
    },
    {
      name: 'binds metrics to the orchestrator on pi; stage models come from the flow frontmatter',
      ctx: { program: 'metrics', flags: {} },
      binding: {
        sequence: Sequence.orchestrator,
        harness: Harness.pi,
        model: DEFAULT_AGENT_MODEL,
        thinkingLevel: undefined,
      },
      trace: { harness: 'binding', model: 'binding', sequence: 'binding' },
    },
    {
      name: 'binds replay-vision to the orchestrator sequence',
      ctx: { program: 'replay-vision', flags: {} },
      binding: {
        sequence: Sequence.orchestrator,
        harness: Harness.anthropic,
        model: DEFAULT_AGENT_MODEL,
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
        thinkingLevel: DEFAULT_BINDING.thinkingLevel,
      },
      trace: { harness: 'binding', model: 'binding', sequence: 'binding' },
    },
  ]);
});

describe('switchboard CLI precedence (dev builds)', () => {
  runBindingCases([
    {
      name: 'cliHarness wins over the orchestrator flag being off',
      ctx: {
        program: 'posthog-integration',
        flags: { [WIZARD_ORCHESTRATOR_FLAG_KEY]: 'false' },
        cliHarness: Harness.pi,
      },
      binding: { ...DEFAULT_RESOLVED, harness: Harness.pi },
      trace: { harness: 'cli', model: 'binding', sequence: 'binding' },
    },
    {
      name: 'cliModel wins over the flag pin; the flag still routes harness + sequence',
      ctx: {
        program: 'posthog-integration',
        flags: { [WIZARD_ORCHESTRATOR_FLAG_KEY]: 'true' },
        cliModel: 'openai/o4-mini',
      },
      binding: {
        sequence: Sequence.orchestrator,
        harness: Harness.pi,
        model: 'openai/o4-mini',
        thinkingLevel: 'medium',
      },
      trace: { harness: 'flag', model: 'cli', sequence: 'flag' },
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
        thinkingLevel: 'medium',
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
      name: 'the one flag → orchestrator on pi; the model stays traced to the binding it fell back to',
      ctx: {
        program: 'posthog-integration',
        flags: { [WIZARD_ORCHESTRATOR_FLAG_KEY]: 'true' },
      },
      binding: {
        sequence: Sequence.orchestrator,
        harness: Harness.pi,
        model: GPT5_6_SOL_MODEL,
        thinkingLevel: 'medium',
      },
      trace: { harness: 'flag', model: 'binding', sequence: 'flag' },
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
      // The flag routes posthog-integration's harness to pi; the composed
      // clamp holds every sequence at linear — the orchestrator bindings
      // (metrics, replay-vision) included; other axes keep their bindings.
      expect(resolveBinding(ctx)).toEqual(
        program === 'ai-observability'
          ? {
              ...DEFAULT_RESOLVED,
              harness: Harness.anthropic,
              model: SONNET_5_MODEL,
              thinkingLevel: undefined,
            }
          : program === 'metrics'
          ? { ...DEFAULT_RESOLVED, model: DEFAULT_AGENT_MODEL, thinkingLevel: undefined }
          : program === 'replay-vision'
          ? {
              ...DEFAULT_RESOLVED,
              harness: Harness.anthropic,
              model: DEFAULT_AGENT_MODEL,
              thinkingLevel: undefined,
            }
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
        flags: { [WIZARD_ORCHESTRATOR_FLAG_KEY]: 'true' },
      },
      binding: { ...DEFAULT_RESOLVED, harness: Harness.pi },
      trace: { harness: 'flag', model: 'binding', sequence: 'composed' },
    },
  ]);
});

describe('switchboard modelCapabilities (stage 2: effective effort)', () => {
  it('marks the known reasoning models as reasoning', () => {
    for (const m of [SONNET_5_MODEL, HAIKU_MODEL, GPT5_6_TERRA_MODEL]) {
      expect(modelCapabilities(m).reasoning).toBe(true);
    }
  });

  it('defaults a non-reasoning openai model (gpt-4o) to no reasoning', () => {
    // The bug that no-op'd gpt-4o: reasoning:true → reasoning_effort → gateway
    // UnsupportedParamsError.
    expect(modelCapabilities('openai/gpt-4o').reasoning).toBe(false);
  });

  it('sets reasoning effort per model across the gpt-5.6 line', () => {
    // The gpt-5.6 line are reasoning models despite the openai/ prefix; they opt in past the default-off.
    for (const m of [GPT5_6_LUNA_MODEL, GPT5_6_TERRA_MODEL, GPT5_6_SOL_MODEL]) {
      expect(modelCapabilities(m).reasoning).toBe(true);
    }
    // luna stays low (fast); terra and sol run medium, the level the mint pins.
    expect(modelCapabilities(GPT5_6_LUNA_MODEL).thinkingLevel).toBe('low');
    expect(modelCapabilities(GPT5_6_TERRA_MODEL).thinkingLevel).toBe('medium');
    expect(modelCapabilities(GPT5_6_SOL_MODEL).thinkingLevel).toBe('medium');
    // The anthropic default carries an explicit effort: an unpinned reasoning
    // model leaves the level to the harness, which the mint then refuses.
    expect(modelCapabilities(DEFAULT_AGENT_MODEL).thinkingLevel).toBe('high');
  });

  // The mint pins effort per model, so a reasoning model resolving to a level
  // outside its pin is refused mid-run with no tool calls.
  it('resolves every model to an effort the mint allows', () => {
    for (const model of VALID_MODELS) {
      const { reasoning, thinkingLevel } = modelCapabilities(model);
      const allowed = MINT_ALLOWED_EFFORTS[model] ?? [];
      // A reasoning model with no pinned level sends the harness default, which
      // is never one of the mint's levels; no reasoning at all is its "none".
      const declared = reasoning ? thinkingLevel ?? 'harness-default' : 'off';
      expect([model, allowed.includes(declared as never)]).toEqual([
        model,
        true,
      ]);
    }
  });

  it('defaults unknown models by transport: anthropic on, openai off', () => {
    expect(modelCapabilities('claude-future-9').reasoning).toBe(true);
    expect(modelCapabilities('openai/whatever').reasoning).toBe(false);
  });

  it('a binding thinkingLevel override rides only a reasoning model', () => {
    expect(modelCapabilities(GPT5_6_TERRA_MODEL, 'high').thinkingLevel).toBe(
      'high',
    );
    expect(modelCapabilities(GPT5_6_TERRA_MODEL).thinkingLevel).toBe('medium');
    expect(
      modelCapabilities('openai/gpt-4o', 'high').thinkingLevel,
    ).toBeUndefined();
  });
});

describe('switchboard model allow-list', () => {
  /**
   * The gateway's mint allow-list, as Django pins it into `allowed_models`
   * (`WIZARD_MODEL_ALLOWLIST` in posthog `posthog/llm/wizard_gateway_token.py`),
   * with the `openai/` prefix Django strips already off. The gateway refuses a
   * model outside it, so this list bounds what the wizard may dispatch.
   */
  const GATEWAY_ALLOWLIST = [
    'claude-sonnet-5',
    'claude-haiku-4-5',
    'gpt-5.6-luna',
    'gpt-5.6-sol',
    'gpt-5.6-terra',
  ];
  const bare = (model: string): string => model.replace(/^openai\//, '');

  it('never widens past the gateway mint allow-list', () => {
    expect([...VALID_MODELS].map(bare).sort()).toEqual(
      [...GATEWAY_ALLOWLIST].sort(),
    );
    // Triage runs on the same token, so its models are bound by the same list.
    for (const model of Object.values(TRIAGE_MODELS)) {
      expect(GATEWAY_ALLOWLIST).toContain(bare(model));
    }
  });

  it('allow-lists the sonnet, haiku and gpt-5.6 line, nothing older', () => {
    for (const m of [
      DEFAULT_AGENT_MODEL,
      SONNET_5_MODEL,
      HAIKU_MODEL,
      GPT5_6_LUNA_MODEL,
      GPT5_6_TERRA_MODEL,
      GPT5_6_SOL_MODEL,
    ]) {
      expect(isValidModel(m)).toBe(true);
    }
    // The retired openai ids are gone — no longer valid to dispatch on.
    for (const m of ['openai/gpt-5', 'openai/gpt-5.4', 'openai/gpt-5.5']) {
      expect(isValidModel(m)).toBe(false);
    }
    // Dropped from the gateway's allow-list, so they must fail here first.
    for (const m of [
      'claude-sonnet-4-6',
      'claude-opus-4-8',
      'claude-haiku-4-5-20251001',
    ]) {
      expect(isValidModel(m)).toBe(false);
    }
    expect(isValidModel('')).toBe(false);
    expect(isValidModel(undefined)).toBe(false);
  });

  it('requireKnownModel takes the first allow-listed candidate', () => {
    expect(requireKnownModel(undefined, GPT5_6_TERRA_MODEL)).toBe(
      GPT5_6_TERRA_MODEL,
    );
    expect(requireKnownModel('openai/gpt-5', GPT5_6_TERRA_MODEL)).toBe(
      GPT5_6_TERRA_MODEL,
    );
  });

  it('requireKnownModel throws loud when no candidate is allow-listed', () => {
    // A dead/empty id must fail here, not reach the gateway.
    expect(() => requireKnownModel(undefined, '', 'openai/gpt-5')).toThrow(
      /No valid model/,
    );
  });
});
