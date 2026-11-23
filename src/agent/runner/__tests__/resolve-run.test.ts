/** The `switchboard resolved` event a run records, over the real resolvers. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GPT5_6_SOL_MODEL, Harness, Sequence } from '@shared/constants';
import { analytics } from '@utils/analytics';
import { resolveRunConfig } from '@agent/runner/switchboard/resolve-run';
import type { ProgramBinding } from '@agent/runner/switchboard';
import type { RunConfig } from '@agent/runner/shared/types';

vi.mock('@utils/analytics');

const config = (binding: ProgramBinding): RunConfig => ({
  programId: 'posthog-integration',
  run: { integrationLabel: 'nextjs' } as RunConfig['run'],
  composed: false,
  routing: { binding },
  skillsBaseUrl: 'https://skills.test',
  wizardFlags: {},
  wizardFlagPayloads: {},
});

const recorded = () =>
  vi
    .mocked(analytics.wizardCapture)
    .mock.calls.find(([event]) => event === 'switchboard resolved')?.[1];

describe('the switchboard resolved event', () => {
  beforeEach(() => vi.resetAllMocks());

  it('reports an orchestrator binding as the source of every axis, with the model chosen per task', () => {
    resolveRunConfig(
      config({
        sequence: Sequence.orchestrator,
        harness: Harness.pi,
        model: GPT5_6_SOL_MODEL,
        thinkingLevel: 'medium',
      }),
    );

    expect(recorded()).toStrictEqual({
      program: 'posthog-integration',
      flag_self_driving_use_pi_harness: undefined,
      flag_self_driving_pi_payload: 'null',
      cli_harness: undefined,
      cli_sequence: undefined,
      cli_model: undefined,
      harness_source: 'binding',
      model_source: 'agent-prompts',
      sequence_source: 'binding',
      harness: Harness.pi,
      model: 'chosen-per-task',
      thinking_level: 'medium',
      sequence: Sequence.orchestrator,
    });
  });

  it('reports a linear binding with its own model', () => {
    resolveRunConfig(
      config({
        sequence: Sequence.linear,
        harness: Harness.pi,
        model: GPT5_6_SOL_MODEL,
      }),
    );

    expect(recorded()).toMatchObject({
      model: GPT5_6_SOL_MODEL,
      model_source: 'binding',
      sequence: Sequence.linear,
      sequence_source: 'binding',
    });
  });
});
