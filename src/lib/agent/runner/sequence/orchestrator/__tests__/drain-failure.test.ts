import { drainFailureError } from '../drain-failure';

describe('drainFailureError', () => {
  it('returns nothing when the drain finished everything', () => {
    expect(drainFailureError({ failed: 0, blocked: 0 })).toBeUndefined();
  });

  it('reports failed tasks when retries were exhausted', () => {
    expect(drainFailureError({ failed: 1, blocked: 0 })).toBe(
      'orchestrator drain ended with failed tasks',
    );
  });

  it('does not call a blocked-only drain a failure', () => {
    const name = drainFailureError({ failed: 0, blocked: 3 });

    expect(name).toBe('orchestrator drain ended with tasks that never ran');
    expect(name).not.toContain('failed');
  });

  it('prefers the failure when tasks both failed and stayed blocked', () => {
    // Blocked tasks are usually downstream of the failure, so the failed types
    // are the actionable detail — described by describeDrainFailure.
    expect(drainFailureError({ failed: 1, blocked: 2 })).toBe(
      'orchestrator drain ended with failed tasks',
    );
  });
});
