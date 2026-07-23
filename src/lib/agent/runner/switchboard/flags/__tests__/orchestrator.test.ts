/**
 * Orchestrator experiment (wizard-orchestrator) — the single gate. Routes the
 * sequence AND the pi harness (pinned sol-medium) for ONLY the programs it
 * declares — context-mill publishes orchestrator agent prompts per flow, so an
 * uncovered program entering the orchestrator fails with "No seed agent
 * prompt" (the 2026-07-17 self-driving incident).
 */
import { describe, it, expect, vi } from 'vitest';
import { PROGRAM_REGISTRY } from '@lib/programs/program-registry';
import {
  DEFAULT_AGENT_MODEL,
  GPT5_6_SOL_MODEL,
  GPT5_6_TERRA_MODEL,
  Harness,
  Sequence,
  WIZARD_ORCHESTRATOR_FLAG_KEY,
  WIZARD_SELF_DRIVING_USE_PI_HARNESS_FLAG_KEY,
} from '@lib/constants';
import {
  resolveBinding,
  type SwitchboardCtx,
} from '@lib/agent/runner/switchboard';
import {
  ORCHESTRATOR_EXPERIMENT,
  ORCHESTRATOR_PI_ROUTE,
} from '@lib/agent/runner/switchboard/flags/orchestrator';
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
const ORCH_ON = { [WIZARD_ORCHESTRATOR_FLAG_KEY]: 'true' };
const SD_FLAG = WIZARD_SELF_DRIVING_USE_PI_HARNESS_FLAG_KEY;

const NON_FLAGGED = {
  sequence: Sequence.linear,
  harness: Harness.anthropic,
  model: DEFAULT_AGENT_MODEL,
  thinkingLevel: undefined,
} as const;
const ORCHESTRATOR_PI = {
  sequence: Sequence.orchestrator,
  harness: Harness.pi,
  model: GPT5_6_SOL_MODEL,
  thinkingLevel: 'medium',
} as const;

describe('orchestrator experiment — scope declaration', () => {
  it('declares a non-empty program list, every entry a registry program', () => {
    expect(ORCHESTRATOR_EXPERIMENT.programs.length).toBeGreaterThan(0);
    for (const p of ORCHESTRATOR_EXPERIMENT.programs) {
      expect(PROGRAM_IDS).toContain(p);
    }
  });

  it('covers exactly posthog-integration today — widening this list is a deliberate act', () => {
    expect(ORCHESTRATOR_EXPERIMENT.programs).toEqual(['posthog-integration']);
  });

  it('the pi route rides the same flag for the same program', () => {
    expect(ORCHESTRATOR_PI_ROUTE.program).toBe('posthog-integration');
    expect(ORCHESTRATOR_PI_ROUTE.flags.useFlag).toBe(
      WIZARD_ORCHESTRATOR_FLAG_KEY,
    );
    expect(ORCHESTRATOR_EXPERIMENT.flag).toBe(WIZARD_ORCHESTRATOR_FLAG_KEY);
  });
});

describe('orchestrator experiment — flag in, binding out', () => {
  runBindingCases(
    [
      {
        name: 'flag alone → orchestrator on pi, pinned sol-medium',
        ctx: { program: 'posthog-integration', flags: ORCH_ON },
        binding: ORCHESTRATOR_PI,
        trace: { harness: 'flag', model: 'flag', sequence: 'flag' },
      },
      {
        name: 'stray flags on top → inert, the pin never reads them',
        ctx: {
          program: 'posthog-integration',
          flags: { ...ORCH_ON, 'wizard-pi-model': 'gpt-5-6-terra' },
        },
        binding: ORCHESTRATOR_PI,
      },
      {
        name: "flag 'false' → nothing moves",
        ctx: {
          program: 'posthog-integration',
          flags: { [WIZARD_ORCHESTRATOR_FLAG_KEY]: 'false' },
        },
        binding: NON_FLAGGED,
      },
      {
        name: "flag garbage ('linear') → nothing moves",
        ctx: {
          program: 'posthog-integration',
          flags: { [WIZARD_ORCHESTRATOR_FLAG_KEY]: 'linear' },
        },
        binding: NON_FLAGGED,
      },
      {
        name: 'CLI --sequence wins over the flag; the harness route stays',
        ctx: {
          program: 'posthog-integration',
          flags: ORCH_ON,
          cliSequence: Sequence.linear,
        },
        binding: { ...ORCHESTRATOR_PI, sequence: Sequence.linear },
        trace: { harness: 'flag', model: 'flag', sequence: 'cli' },
      },
      {
        // The harness axis is code-gated on cloud (like every harness
        // experiment); the sequence axis is scoped by the flag's own
        // run_surface targeting (#961).
        name: 'cloud surface → the harness route is disabled',
        surface: 'cloud',
        ctx: { program: 'posthog-integration', flags: ORCH_ON },
        binding: { ...NON_FLAGGED, sequence: Sequence.orchestrator },
      },
    ],
    setSurface,
  );
});

describe('orchestrator experiment — isolation', () => {
  it('the flag leaves every uncovered registry program exactly as unflagged', () => {
    for (const program of PROGRAM_IDS) {
      if (ORCHESTRATOR_EXPERIMENT.programs.includes(program)) continue;
      const ctx: SwitchboardCtx = { program, flags: ORCH_ON };
      expect(resolveBinding(ctx)).toEqual(
        resolveBinding({ program, flags: {} }),
      );
      expect(ctx.trace).toEqual({
        harness: 'binding',
        model: 'binding',
        sequence: 'binding',
      });
    }
  });

  runBindingCases([
    {
      // Even with self-driving's own pi flag routing harness/model, the
      // global orchestrator flag must not move its sequence — only the
      // self-driving payload's `sequence` field may.
      name: 'regression (2026-07-17): self-driving never rides the global flag into the orchestrator',
      ctx: {
        program: 'self-driving',
        flags: { ...ORCH_ON, [SD_FLAG]: 'true' },
        flagPayloads: {
          [SD_FLAG]: { model: 'gpt-5-6-terra', effort: 'high' },
        },
      },
      binding: {
        sequence: Sequence.linear,
        harness: Harness.pi,
        model: GPT5_6_TERRA_MODEL,
        thinkingLevel: 'high',
      },
      trace: { harness: 'flag', model: 'flag', sequence: 'binding' },
    },
  ]);
});
