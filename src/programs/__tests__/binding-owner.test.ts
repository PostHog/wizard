import { describe, expect, it } from 'vitest';
import {
  GPT5_6_TERRA_MODEL,
  Harness,
  Sequence,
  WIZARD_ORCHESTRATOR_FLAG_KEY,
  WIZARD_SELF_DRIVING_USE_PI_HARNESS_FLAG_KEY,
} from '@shared/constants';
import { HARNESS_RUNS_TASKS } from '@agent/runner/switchboard/resolve-harness';
import { PROGRAM_BINDINGS, resolveProgramBinding } from '@programs';

describe('program binding owner', () => {
  it('resolves and traces a CLI sequence override ahead of an experiment', () => {
    const trace = {};
    const binding = resolveProgramBinding({
      program: 'posthog-integration',
      flags: { [WIZARD_ORCHESTRATOR_FLAG_KEY]: 'true' },
      cliSequence: Sequence.linear,
      trace,
    });
    expect(binding.sequence).toBe(Sequence.linear);
    expect(trace).toMatchObject({ sequence: 'cli', harness: 'flag' });
  });

  it('pre-resolves task roles with flag routes above role defaults', () => {
    const original = PROGRAM_BINDINGS['posthog-integration'];
    PROGRAM_BINDINGS['posthog-integration'] = {
      sequence: Sequence.linear,
      harness: Harness.anthropic,
      model: 'claude-sonnet-4-5',
      contextMillOverride: {
        seed: { model: GPT5_6_TERRA_MODEL, thinkingLevel: 'high' },
      },
    };
    try {
      const binding = resolveProgramBinding({
        program: 'posthog-integration',
        flags: { [WIZARD_ORCHESTRATOR_FLAG_KEY]: 'true' },
      });
      expect(binding).toMatchObject({
        harness: Harness.pi,
        roleBindings: {
          seed: {
            harness: Harness.pi,
            model: GPT5_6_TERRA_MODEL,
            thinkingLevel: 'high',
          },
        },
      });
    } finally {
      PROGRAM_BINDINGS['posthog-integration'] = original;
    }
  });

  it('clamps a flag route without runTask while preserving the dev CLI hard-error route', () => {
    HARNESS_RUNS_TASKS[Harness.anthropic] = false;
    const input = {
      program: 'self-driving',
      flags: { [WIZARD_SELF_DRIVING_USE_PI_HARNESS_FLAG_KEY]: 'true' },
      flagPayloads: {
        [WIZARD_SELF_DRIVING_USE_PI_HARNESS_FLAG_KEY]: {
          model: 'gpt-5-6-sol',
          harness: Harness.anthropic,
          sequence: Sequence.orchestrator,
        },
      },
    };
    try {
      const flagTrace = {};
      expect(
        resolveProgramBinding({ ...input, trace: flagTrace }).sequence,
      ).toBe(Sequence.linear);
      expect(flagTrace).toMatchObject({ sequence: 'runtask-clamp' });

      const cliTrace = {};
      expect(
        resolveProgramBinding({
          ...input,
          cliSequence: Sequence.orchestrator,
          trace: cliTrace,
        }).sequence,
      ).toBe(Sequence.orchestrator);
      expect(cliTrace).toMatchObject({ sequence: 'cli' });
    } finally {
      HARNESS_RUNS_TASKS[Harness.anthropic] = true;
    }
  });
});
