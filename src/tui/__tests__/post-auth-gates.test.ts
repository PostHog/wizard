/**
 * Golden of the post-auth gate ids the agent runner awaits per program. Reads
 * the same `postAuthGateSteps` walk that runner/shared/bootstrap.ts awaits.
 */
import { PROGRAM_REGISTRY } from '@programs';
import { postAuthGateSteps } from '../flows/flow';
import { rawProgramFlow } from '../flows/index';

describe('post-auth gate ids per program', () => {
  it('match the golden', () => {
    const gates = Object.fromEntries(
      PROGRAM_REGISTRY.map((c) => [
        c.id,
        postAuthGateSteps(rawProgramFlow(c.id)).map((s) => s.id),
      ]),
    );
    expect(gates).toMatchSnapshot();
  });
});
