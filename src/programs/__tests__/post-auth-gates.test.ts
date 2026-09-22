/**
 * Golden of the post-auth gate ids the agent runner awaits per program. Reads
 * the same `postAuthGateSteps` walk that runner/shared/bootstrap.ts awaits.
 */
import { PROGRAM_REGISTRY } from '../program-registry';
import { postAuthGateSteps } from '../program-step';

describe('post-auth gate ids per program', () => {
  it('match the golden', () => {
    const gates = Object.fromEntries(
      PROGRAM_REGISTRY.map((c) => [
        c.id,
        postAuthGateSteps(c.steps).map((s) => s.id),
      ]),
    );
    expect(gates).toMatchSnapshot();
  });
});
