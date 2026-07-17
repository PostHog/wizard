/**
 * Orchestrator experiment (wizard-orchestrator). Routes the sequence axis for
 * ONLY the programs it declares — context-mill publishes orchestrator agent
 * prompts per flow, so an uncovered program entering the orchestrator fails
 * with "No seed agent prompt" (the 2026-07-17 self-driving incident).
 *
 * Every test is (SwitchboardCtx in) → (full resolveBinding out): the flag may
 * move the sequence axis of covered programs and NOTHING else, and the tests
 * look at all four axes to prove it.
 */
import { describe, it, expect } from 'vitest';
import { PROGRAM_REGISTRY } from '@lib/programs/program-registry';
import {
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

const PROGRAM_IDS = PROGRAM_REGISTRY.map((c) => c.id);
const ORCH_ON = { [WIZARD_ORCHESTRATOR_FLAG_KEY]: 'true' };

const bind = (ctx: SwitchboardCtx) => resolveBinding(ctx);

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
      const unflagged = bind({ program, flags: {} });
      expect(bind({ program, flags: ORCH_ON })).toEqual({
        ...unflagged,
        sequence: ORCHESTRATOR_EXPERIMENT.sequence,
      });
    }
  });

  it('a non-"true" flag value changes nothing at all', () => {
    for (const value of ['false', 'linear', 'banana']) {
      expect(
        bind({
          program: 'posthog-integration',
          flags: { [WIZARD_ORCHESTRATOR_FLAG_KEY]: value },
        }),
      ).toEqual(bind({ program: 'posthog-integration', flags: {} }));
    }
  });

  it('CLI --sequence wins over the flag, everything else untouched', () => {
    const unflagged = bind({ program: 'posthog-integration', flags: {} });
    expect(
      bind({
        program: 'posthog-integration',
        flags: ORCH_ON,
        cliSequence: Sequence.linear,
      }),
    ).toEqual(unflagged);
  });
});

describe('orchestrator experiment — isolation', () => {
  it('the flag leaves every uncovered registry program exactly as unflagged', () => {
    for (const program of PROGRAM_IDS) {
      if (ORCHESTRATOR_EXPERIMENT.programs.includes(program)) continue;
      const ctx: SwitchboardCtx = { program, flags: ORCH_ON };
      expect(bind(ctx)).toEqual(bind({ program, flags: {} }));
      expect(ctx.trace?.sequence).toBe('binding');
    }
  });

  it('regression (2026-07-17): self-driving never rides the global flag into the orchestrator', () => {
    // Even with self-driving's own pi flag routing harness/model, the global
    // orchestrator flag must not move its sequence — only the self-driving
    // payload's `sequence` field may.
    const ctx: SwitchboardCtx = {
      program: 'self-driving',
      flags: {
        ...ORCH_ON,
        [WIZARD_SELF_DRIVING_USE_PI_HARNESS_FLAG_KEY]: 'true',
      },
      flagPayloads: {
        [WIZARD_SELF_DRIVING_USE_PI_HARNESS_FLAG_KEY]: {
          model: 'gpt-5-6-terra',
          effort: 'high',
        },
      },
    };
    expect(bind(ctx)).toEqual({
      sequence: Sequence.linear,
      harness: Harness.pi,
      model: GPT5_6_TERRA_MODEL,
      thinkingLevel: 'high',
    });
    expect(ctx.trace?.sequence).toBe('binding');
  });
});
