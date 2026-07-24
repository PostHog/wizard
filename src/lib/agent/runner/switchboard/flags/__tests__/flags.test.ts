/** The flag truth table: every wizard flag combination → the full four-axis binding, pinned literally, plus isolation and the no-flag-reads-outside-flags/ seam scan. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { PROGRAM_REGISTRY } from '@lib/programs/program-registry';
import * as constants from '@lib/constants';
import {
  DEFAULT_AGENT_MODEL,
  GPT5_6_TERRA_MODEL,
  Harness,
  Sequence,
  WIZARD_ORCHESTRATOR_FLAG_KEY,
  WIZARD_ORCHESTRATOR_OVERRIDE_FLAG_KEY,
  WIZARD_SELF_DRIVING_USE_PI_HARNESS_FLAG_KEY,
  SONNET_5_MODEL,
} from '@lib/constants';
import {
  resolveBinding,
  resolveStageOverride,
  type SwitchboardCtx,
} from '@lib/agent/runner/switchboard';
import {
  ORCHESTRATOR_SEQUENCE_ROUTE,
  ORCHESTRATOR_HARNESS_ROUTE,
} from '@lib/agent/runner/switchboard/flags/orchestrator';
import { SELF_DRIVING_EXPERIMENT } from '@lib/agent/runner/switchboard/flags/self-driving';
import { runBindingCases } from './binding-cases';

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
const ORCH = WIZARD_ORCHESTRATOR_FLAG_KEY;
const SD = WIZARD_SELF_DRIVING_USE_PI_HARNESS_FLAG_KEY;

const LINEAR_ANTHROPIC_DEFAULT = {
  sequence: Sequence.linear,
  harness: Harness.anthropic,
  model: DEFAULT_AGENT_MODEL,
  thinkingLevel: undefined,
} as const;
const ORCHESTRATOR_PI_DEFAULT = {
  sequence: Sequence.orchestrator,
  harness: Harness.pi,
  model: DEFAULT_AGENT_MODEL,
  thinkingLevel: undefined,
} as const;

describe('flag declarations', () => {
  it('wizard-orchestrator covers exactly posthog-integration, both axes, one flag', () => {
    expect(ORCHESTRATOR_SEQUENCE_ROUTE.programs).toEqual([
      'posthog-integration',
    ]);
    expect(ORCHESTRATOR_HARNESS_ROUTE.program).toBe('posthog-integration');
    expect(ORCHESTRATOR_SEQUENCE_ROUTE.flag).toBe(ORCH);
    expect(ORCHESTRATOR_HARNESS_ROUTE.flags.useFlag).toBe(ORCH);
  });

  it('self-driving pi covers exactly self-driving', () => {
    expect(SELF_DRIVING_EXPERIMENT.program).toBe('self-driving');
    expect(SELF_DRIVING_EXPERIMENT.flags.useFlag).toBe(SD);
  });
});

describe('the truth table — posthog-integration × wizard-orchestrator', () => {
  runBindingCases(
    [
      {
        name: 'off/absent → linear on anthropic, default model',
        ctx: { program: 'posthog-integration', flags: {} },
        binding: LINEAR_ANTHROPIC_DEFAULT,
        trace: { harness: 'binding', model: 'binding', sequence: 'binding' },
      },
      {
        name: "'false' → identical to absent",
        ctx: { program: 'posthog-integration', flags: { [ORCH]: 'false' } },
        binding: LINEAR_ANTHROPIC_DEFAULT,
      },
      {
        name: "garbage ('banana') → identical to absent",
        ctx: { program: 'posthog-integration', flags: { [ORCH]: 'banana' } },
        binding: LINEAR_ANTHROPIC_DEFAULT,
      },
      {
        name: "'true' → orchestrator on pi; model stays the binding default (frontmatter decides per task)",
        ctx: { program: 'posthog-integration', flags: { [ORCH]: 'true' } },
        binding: ORCHESTRATOR_PI_DEFAULT,
        trace: { harness: 'flag', model: 'flag', sequence: 'flag' },
      },
      {
        name: "'true' + retired pi flags → identical, nothing reads them",
        ctx: {
          program: 'posthog-integration',
          flags: {
            [ORCH]: 'true',
            'wizard-use-pi-harness': 'true',
            'wizard-pi-model': 'gpt-5-6-terra',
            'wizard-pi-effort': 'high',
          },
        },
        binding: ORCHESTRATOR_PI_DEFAULT,
      },
      {
        // Harness axis code-gated on cloud; sequence scoping is the flag's own run_surface targeting (#961).
        name: "'true' on the cloud surface → orchestrator sequence, harness route disabled",
        surface: 'cloud',
        ctx: { program: 'posthog-integration', flags: { [ORCH]: 'true' } },
        binding: {
          ...LINEAR_ANTHROPIC_DEFAULT,
          sequence: Sequence.orchestrator,
        },
      },
    ],
    setSurface,
  );
});

describe('the truth table — self-driving × its pi payload flag', () => {
  const PAYLOAD = { model: 'gpt-5-6-terra', effort: 'high' } as const;
  runBindingCases(
    [
      {
        name: 'off/absent → linear on anthropic, default model',
        ctx: { program: 'self-driving', flags: {} },
        binding: LINEAR_ANTHROPIC_DEFAULT,
      },
      {
        name: 'on + full payload → pi on the payload model/effort, payload may pin the sequence too',
        ctx: {
          program: 'self-driving',
          flags: { [SD]: 'true' },
          flagPayloads: { [SD]: { ...PAYLOAD, sequence: 'orchestrator' } },
        },
        binding: {
          sequence: Sequence.orchestrator,
          harness: Harness.pi,
          model: GPT5_6_TERRA_MODEL,
          thinkingLevel: 'high',
        },
      },
      {
        name: 'on + model-only payload → pi on that model, table-default effort, linear',
        ctx: {
          program: 'self-driving',
          flags: { [SD]: 'true' },
          flagPayloads: { [SD]: { model: 'gpt-5-6-terra' } },
        },
        binding: {
          sequence: Sequence.linear,
          harness: Harness.pi,
          model: GPT5_6_TERRA_MODEL,
          thinkingLevel: undefined,
        },
      },
      {
        name: 'on + JSON-string payload → parsed and routed the same',
        ctx: {
          program: 'self-driving',
          flags: { [SD]: 'true' },
          flagPayloads: { [SD]: JSON.stringify(PAYLOAD) },
        },
        binding: {
          sequence: Sequence.linear,
          harness: Harness.pi,
          model: GPT5_6_TERRA_MODEL,
          thinkingLevel: 'high',
        },
      },
      {
        name: 'on + unknown model key → fail closed to the default',
        ctx: {
          program: 'self-driving',
          flags: { [SD]: 'true' },
          flagPayloads: { [SD]: { model: 'banana' } },
        },
        binding: LINEAR_ANTHROPIC_DEFAULT,
      },
      {
        name: 'on + missing payload → fail closed to the default',
        ctx: { program: 'self-driving', flags: { [SD]: 'true' } },
        binding: LINEAR_ANTHROPIC_DEFAULT,
      },
      {
        name: 'on on the cloud surface → fail closed to the default',
        surface: 'cloud',
        ctx: {
          program: 'self-driving',
          flags: { [SD]: 'true' },
          flagPayloads: { [SD]: PAYLOAD },
        },
        binding: LINEAR_ANTHROPIC_DEFAULT,
      },
    ],
    setSurface,
  );
});

describe('the truth table — wizard-orchestrator-override stage payloads', () => {
  const OVR = WIZARD_ORCHESTRATOR_OVERRIDE_FLAG_KEY;
  const armed = (payload: unknown) => ({
    flags: { [OVR]: 'terra-review' },
    payloads: { [OVR]: payload },
  });
  const resolve = (
    stage: string,
    a: { flags: Record<string, string>; payloads?: Record<string, unknown> },
    program = 'posthog-integration',
  ) => resolveStageOverride(program, stage, a.flags, a.payloads);

  it('a stage row overrides model and effort for that stage only', () => {
    const a = armed({
      review: { model: 'gpt-5-6-terra', effort: 'high' },
    });
    expect(resolve('review', a)).toEqual({
      model: GPT5_6_TERRA_MODEL,
      effort: 'high',
    });
    for (const stage of ['seed', 'install', 'capture', 'dashboard']) {
      expect(resolve(stage, a)).toBe(undefined);
    }
  });

  it('partial rows override only what they define', () => {
    const a = armed({
      review: { model: 'gpt-5-6-terra' },
      seed: { effort: 'low' },
    });
    expect(resolve('review', a)).toEqual({
      model: GPT5_6_TERRA_MODEL,
      effort: undefined,
    });
    expect(resolve('seed', a)).toEqual({ model: undefined, effort: 'low' });
  });

  it('a JSON-string payload parses the same', () => {
    const a = armed(JSON.stringify({ review: { model: 'gpt-5-6-terra' } }));
    expect(resolve('review', a)?.model).toBe(GPT5_6_TERRA_MODEL);
  });

  it.each([
    ['unknown model key', { review: { model: 'banana' } }],
    ['invalid effort', { review: { effort: 'banana' } }],
    ['non-object row', { review: 'terra' }],
    ['garbage string', '{not json'],
  ])('%s → the whole payload fails closed', (_name, payload) => {
    expect(resolve('review', armed(payload))).toBe(undefined);
  });

  it('flag absent or false → undefined', () => {
    expect(
      resolveStageOverride(
        'posthog-integration',
        'review',
        {},
        armed({}).payloads,
      ),
    ).toBe(undefined);
    expect(
      resolveStageOverride(
        'posthog-integration',
        'review',
        { [OVR]: 'false' },
        { [OVR]: { review: { model: 'gpt-5-6-terra' } } },
      ),
    ).toBe(undefined);
  });

  it('scoped to the orchestrator programs; cloud surface fails closed', () => {
    const a = armed({ review: { model: 'gpt-5-6-terra' } });
    expect(resolve('review', a, 'self-driving')).toBe(undefined);
    setSurface('cloud');
    try {
      expect(resolve('review', a)).toBe(undefined);
    } finally {
      setSurface('local');
    }
  });
});

describe('isolation — everything on at once', () => {
  const ALL_FLAG_KEYS = Object.entries(constants)
    .filter(([name]) => name.endsWith('_FLAG_KEY'))
    .map(([, value]) => value as string);
  const flags = Object.fromEntries(ALL_FLAG_KEYS.map((k) => [k, 'true']));
  const flagPayloads = Object.fromEntries(
    ALL_FLAG_KEYS.map((k) => [
      k,
      { model: 'gpt-5-6-terra', effort: 'high', sequence: 'orchestrator' },
    ]),
  );

  it('only the two covered programs move; each lands exactly on its own row', () => {
    for (const program of PROGRAM_IDS) {
      const ctx: SwitchboardCtx = { program, flags, flagPayloads };
      const resolved = resolveBinding(ctx);
      if (program === 'posthog-integration') {
        expect(resolved).toEqual(ORCHESTRATOR_PI_DEFAULT);
      } else if (program === 'self-driving') {
        expect(resolved).toEqual({
          sequence: Sequence.orchestrator, // from its own payload only
          harness: Harness.pi,
          model: GPT5_6_TERRA_MODEL,
          thinkingLevel: 'high',
        });
      } else if (program === 'ai-observability') {
        expect(resolved).toEqual({
          ...LINEAR_ANTHROPIC_DEFAULT,
          model: SONNET_5_MODEL,
        });
      } else {
        expect(resolved).toEqual(LINEAR_ANTHROPIC_DEFAULT);
        expect(ctx.trace).toEqual({
          harness: 'binding',
          model: 'binding',
          sequence: 'binding',
        });
      }
    }
  });

  it('regression (2026-07-17): self-driving never rides the global orchestrator flag into the orchestrator', () => {
    const binding = resolveBinding({
      program: 'self-driving',
      flags: { [ORCH]: 'true', [SD]: 'true' },
      flagPayloads: { [SD]: { model: 'gpt-5-6-terra' } },
    });
    expect(binding.sequence).toBe(Sequence.linear);
  });
});

describe('seam scan — routing reads live only in flags/', () => {
  const switchboardDir = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
  );
  // orchestrator-runner consumes a flags/ resolver; it may pass the snapshot through, never index it.
  for (const file of [
    'harness.ts',
    'sequence.ts',
    'models.ts',
    'index.ts',
    '../sequence/orchestrator/orchestrator-runner.ts',
  ]) {
    it(`${file} contains no direct flag reads or flag-key imports`, () => {
      const src = readFileSync(join(switchboardDir, file), 'utf8');
      expect(src).not.toMatch(/ctx\.flags\[/);
      expect(src).not.toMatch(/flags\[['"`]/);
      expect(src).not.toMatch(/WIZARD_\w+_FLAG_KEY/);
    });
  }
});
