/**
 * Golden of the post-auth gate ids the agent runner awaits per program
 * (`postAuthGateIdsFor`, the walk between the `auth` and `run` steps).
 */
import { PROGRAM_REGISTRY } from '../program-registry.js';
import { postAuthGateIdsFor, runConfigFor } from '../run-config.js';

describe('post-auth gate ids per program', () => {
  it('match the golden', () => {
    const gates = Object.fromEntries(
      PROGRAM_REGISTRY.map((c) => [c.id, postAuthGateIdsFor(c.steps)]),
    );
    expect(gates).toMatchSnapshot();
  });
});

describe('health check declared per program', () => {
  it('matches the golden', () => {
    const declared = Object.fromEntries(
      PROGRAM_REGISTRY.map((c) => [c.id, runConfigFor(c).healthCheckDeclared]),
    );
    expect(declared).toMatchSnapshot();
  });
});
