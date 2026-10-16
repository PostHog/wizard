import { describe, expect, it } from 'vitest';
import { Integration } from '@shared/constants';
import { DECISIONS_KEY, getTraits, traitTags } from '../traits';
import type { ProgramSession } from '../program-session';
import type { DecisionsResult } from '../detection/decisions/types';

function session(
  mode: DecisionsResult['mode'],
  answers: DecisionsResult['answers'],
  integration: Integration | null = null,
): ProgramSession {
  const result: DecisionsResult = {
    mode,
    answers,
    unanswered: [],
    model: '',
    durationMs: 0,
    inputTokens: 0,
    redactedLines: 0,
  };
  return {
    integration,
    frameworkContext: { [DECISIONS_KEY]: result },
  } as unknown as ProgramSession;
}

const predicate = (probability: number) =>
  ({ kind: 'predicate', probability } as const);
const choice = (value: string, probability: number) =>
  ({
    kind: 'choice',
    choice: value,
    probability,
    probabilities: { [value]: probability },
  } as const);

describe('getTraits', () => {
  it('reads only static detection while Decisions is in shadow', () => {
    const traits = getTraits(
      session('shadow', { calls_llm_api: predicate(0.01) }, Integration.nextjs),
      'posthog-integration',
    );
    expect(traits).toEqual({
      framework: { value: Integration.nextjs, source: 'static' },
    });
  });

  it('takes confident primary answers and leaves unsure ones absent', () => {
    const traits = getTraits(
      session('primary', {
        calls_llm_api: predicate(0.05),
        structured_logging: predicate(0.4),
        is_monorepo: predicate(0.9),
        observability_stack: choice('new_relic', 0.7),
        build_tool: choice('none', 0.95),
      }),
      'posthog-integration',
    );
    expect(traits.callsLlmApi?.value).toBe('no');
    expect(traits.structuredLogging).toBeUndefined();
    expect(traits.architecture?.value).toBe('monorepo');
    expect(traits.observabilityStack?.value).toBe('new_relic');
    expect(traits.buildTool).toBeUndefined();
  });

  it('keeps static framework detection over a weak disagreeing answer', () => {
    const traits = getTraits(
      session(
        'primary',
        { framework: choice(Integration.astro, 0.7) },
        Integration.nextjs,
      ),
      'posthog-integration',
    );
    expect(traits.framework).toEqual({
      value: Integration.nextjs,
      source: 'static',
    });
  });
});

describe('traitTags', () => {
  it('maps values to the tags skills carry', () => {
    expect(
      traitTags({
        framework: { value: Integration.nextjs, source: 'static' },
        serverRuntime: { value: 'yes', source: 'decisions' },
        webFrontend: { value: 'no', source: 'decisions' },
        observabilityStack: { value: 'new_relic', source: 'decisions' },
      }),
    ).toEqual({
      framework: ['framework:nextjs'],
      serverRuntime: ['server'],
      observabilityStack: ['new-relic'],
    });
  });
});
