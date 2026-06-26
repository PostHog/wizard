import { describe, it, expect } from 'vitest';
import { PROGRAM_REGISTRY } from '@lib/programs/program-registry';
import { ROUTES, MODELS, resolvePair } from '@lib/agent/runner/runner-plan';

const PROGRAM_IDS = PROGRAM_REGISTRY.map((c) => c.id);

describe('runner-plan ROUTES', () => {
  // `ProgramId` widens to `string`, so the type can't force coverage. This is
  // the real guard: add a program without a route and this fails.
  it('declares a route for every registered program', () => {
    const missing = PROGRAM_IDS.filter((id) => !(id in ROUTES));
    expect(missing).toEqual([]);
  });

  it('maps no route to an unregistered program', () => {
    const stale = Object.keys(ROUTES).filter((id) => !PROGRAM_IDS.includes(id));
    expect(stale).toEqual([]);
  });

  it('resolves every program to a registered runner and a known model', () => {
    for (const program of PROGRAM_IDS) {
      const pair = resolvePair({ program, flags: {} });
      expect(['anthropic', 'pi']).toContain(pair.runner);
      expect(MODELS[pair.model]).toBeTruthy();
    }
  });

  // Pins today's behavior: the seam changes nothing until a route is moved.
  it('defaults every program to anthropic / sonnet', () => {
    for (const program of PROGRAM_IDS) {
      expect(resolvePair({ program, flags: {} })).toEqual({
        runner: 'anthropic',
        model: 'sonnet',
      });
    }
  });

  it('falls back to DEFAULT_ROUTE for an unmapped program', () => {
    expect(resolvePair({ program: 'not-a-program', flags: {} })).toEqual({
      runner: 'anthropic',
      model: 'sonnet',
    });
  });
});
