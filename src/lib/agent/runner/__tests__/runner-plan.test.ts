import { describe, it, expect } from 'vitest';
import { PROGRAM_REGISTRY } from '@lib/programs/program-registry';
import { Harness, WIZARD_RUNNER_FLAG_KEY } from '@lib/constants';
import { ROUTES, MODELS, resolvePair } from '@lib/agent/runner/runner-plan';

const PROGRAM_IDS = PROGRAM_REGISTRY.map((c) => c.id);
const A_PROGRAM = PROGRAM_IDS[0];

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
      expect(Object.values(Harness)).toContain(pair.runner);
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

// Precedence at the resolution seam. The CLI override middleware is present in
// dev/test (IS_PRODUCTION_BUILD is false); published builds gate it out, so the
// CLI arm here is unreachable in prod by construction.
describe('runner-plan override precedence', () => {
  it('applies the wizard-runner flag when set to a known harness', () => {
    const pair = resolvePair({
      program: A_PROGRAM,
      flags: { [WIZARD_RUNNER_FLAG_KEY]: Harness.pi },
    });
    expect(pair.runner).toBe(Harness.pi);
  });

  it('ignores an unknown wizard-runner flag value', () => {
    const pair = resolvePair({
      program: A_PROGRAM,
      flags: { [WIZARD_RUNNER_FLAG_KEY]: 'nonsense' },
    });
    expect(pair.runner).toBe(Harness.anthropic);
  });

  it('lets the CLI harness override win over the flag', () => {
    const pair = resolvePair({
      program: A_PROGRAM,
      flags: { [WIZARD_RUNNER_FLAG_KEY]: Harness.anthropic },
      cliHarness: Harness.pi,
    });
    expect(pair.runner).toBe(Harness.pi);
  });

  it('leaves the model untouched when overriding the runner', () => {
    const base = resolvePair({ program: A_PROGRAM, flags: {} });
    const pair = resolvePair({
      program: A_PROGRAM,
      flags: {},
      cliHarness: Harness.pi,
    });
    expect(pair.model).toBe(base.model);
  });
});
