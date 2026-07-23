/**
 * Orchestrator experiment (wizard-orchestrator). Routes the sequence axis for
 * ONLY the programs it declares — context-mill publishes orchestrator agent
 * prompts per flow, so an uncovered program entering the orchestrator fails
 * with "No seed agent prompt" (the 2026-07-17 self-driving incident).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PROGRAM_REGISTRY } from '@lib/programs/program-registry';
import {
  DEFAULT_AGENT_MODEL,
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
import { ORCHESTRATOR_EXPERIMENT } from '@lib/agent/runner/switchboard/flags/orchestrator';
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

const PROGRAM_IDS = PROGRAM_REGISTRY.map((c) => c.id);
const ORCH_ON = { [WIZARD_ORCHESTRATOR_FLAG_KEY]: 'true' };
const SD_FLAG = WIZARD_SELF_DRIVING_USE_PI_HARNESS_FLAG_KEY;

const ANTHROPIC_DEFAULT = {
  harness: Harness.anthropic,
  model: DEFAULT_AGENT_MODEL,
  thinkingLevel: undefined,
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
});

describe('orchestrator experiment — flag in, binding out', () => {
  it('moves ONLY the sequence axis of every declared program', () => {
    for (const program of ORCHESTRATOR_EXPERIMENT.programs) {
      const unflagged = resolveBinding({ program, flags: {} });
      expect(resolveBinding({ program, flags: ORCH_ON })).toEqual({
        ...unflagged,
        sequence: ORCHESTRATOR_EXPERIMENT.sequence,
      });
    }
  });

  runBindingCases([
    {
      name: "flag 'false' → nothing moves",
      ctx: {
        program: 'posthog-integration',
        flags: { [WIZARD_ORCHESTRATOR_FLAG_KEY]: 'false' },
      },
      binding: { sequence: Sequence.linear, ...ANTHROPIC_DEFAULT },
    },
    {
      name: "flag garbage ('linear') → nothing moves",
      ctx: {
        program: 'posthog-integration',
        flags: { [WIZARD_ORCHESTRATOR_FLAG_KEY]: 'linear' },
      },
      binding: { sequence: Sequence.linear, ...ANTHROPIC_DEFAULT },
    },
    {
      name: 'CLI --sequence wins over the flag, everything else untouched',
      ctx: {
        program: 'posthog-integration',
        flags: ORCH_ON,
        cliSequence: Sequence.linear,
      },
      binding: { sequence: Sequence.linear, ...ANTHROPIC_DEFAULT },
    },
  ]);
});

describe('orchestrator experiment — isolation', () => {
  afterEach(() => {
    envState.runSurface = 'local';
  });

  // The 2026-07-22 leak: pi is local-only (harness experiments already gate on
  // the surface), so on cloud the flag paired the orchestrator with the
  // anthropic binding fallback instead of its pi arm.
  it('cloud (headless) surface → the flag routes nothing, run stays linear', () => {
    envState.runSurface = 'cloud';
    const ctx: SwitchboardCtx = {
      program: 'posthog-integration',
      flags: ORCH_ON,
    };
    expect(resolveBinding(ctx)).toEqual({
      sequence: Sequence.linear,
      ...ANTHROPIC_DEFAULT,
    });
    expect(ctx.trace?.sequence).toBe('binding');
  });

  it('the flag leaves every uncovered registry program exactly as unflagged', () => {
    for (const program of PROGRAM_IDS) {
      if (ORCHESTRATOR_EXPERIMENT.programs.includes(program)) continue;
      const ctx: SwitchboardCtx = { program, flags: ORCH_ON };
      expect(resolveBinding(ctx)).toEqual(
        resolveBinding({ program, flags: {} }),
      );
      expect(ctx.trace?.sequence).toBe('binding');
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
