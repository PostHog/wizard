import { drainFailure } from '../drain-failure';

describe('drainFailure', () => {
  it('returns nothing when the drain finished everything', () => {
    expect(
      drainFailure({ failed: 0, blocked: 0, failedTypes: '' }),
    ).toBeUndefined();
  });

  it('reports failed tasks when retries were exhausted', () => {
    expect(
      drainFailure({ failed: 1, blocked: 0, failedTypes: 'instrument' }),
    ).toEqual({
      error: 'orchestrator drain ended with failed tasks',
      reason: 'the instrument step failed',
    });
  });

  it('does not call a blocked-only drain a failure', () => {
    const failure = drainFailure({ failed: 0, blocked: 3, failedTypes: '' });

    expect(failure?.error).toBe(
      'orchestrator drain ended with tasks that never ran',
    );
    expect(failure?.error).not.toContain('failed');
    expect(failure?.reason).toBe('3 steps never ran');
  });

  it('keeps the reason grammatical for a single blocked task', () => {
    expect(
      drainFailure({ failed: 0, blocked: 1, failedTypes: '' })?.reason,
    ).toBe('1 step never ran');
  });

  it('prefers the failure when tasks both failed and stayed blocked', () => {
    // Blocked tasks are usually downstream of the failure, so the failed types
    // are the actionable detail.
    expect(
      drainFailure({ failed: 1, blocked: 2, failedTypes: 'review' }),
    ).toEqual({
      error: 'orchestrator drain ended with failed tasks',
      reason: 'the review step failed',
    });
  });
});
