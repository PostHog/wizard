/**
 * Golden of the post-auth gate ids the agent runner awaits per program
 * (the walk at runner/shared/bootstrap.ts between the `auth` and `run` steps).
 */
import { PROGRAM_REGISTRY } from '../program-registry';

function legacyPostAuthGateIds(
  steps: (typeof PROGRAM_REGISTRY)[number]['steps'],
): string[] {
  const authIndex = steps.findIndex((s) => s.screenId === 'auth');
  const runIndex = steps.findIndex((s) => s.screenId === 'run');
  if (authIndex === -1 || runIndex <= authIndex) return [];
  return steps
    .slice(authIndex + 1, runIndex)
    .filter((s) => s.gate)
    .map((s) => s.id);
}

describe('post-auth gate ids per program', () => {
  it('match the golden', () => {
    const gates = Object.fromEntries(
      PROGRAM_REGISTRY.map((c) => [c.id, legacyPostAuthGateIds(c.steps)]),
    );
    expect(gates).toMatchSnapshot();
  });
});
