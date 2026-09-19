import { OutroKind, RunPhase } from '@store';
import { runStatus } from '@e2e-harness/run-status';

const session = (
  runPhase: RunPhase,
  over: { runRequested?: boolean; message?: string } = {},
) => ({
  runPhase,
  runRequested: over.runRequested ?? false,
  outroData: over.message
    ? { kind: OutroKind.Error, message: over.message }
    : null,
});

describe('the MCP run status', () => {
  it.each([
    [RunPhase.Idle, 'idle'],
    [RunPhase.Running, 'running'],
    [RunPhase.Completed, 'done'],
    [RunPhase.Error, 'failed'],
  ])('maps %s to %s', (phase, status) => {
    expect(runStatus(session(phase)).integration).toBe(status);
  });

  it('reports an armed but not yet started run as running', () => {
    expect(
      runStatus(session(RunPhase.Idle, { runRequested: true })).integration,
    ).toBe('running');
  });

  it('carries the failure reason only for a failed run', () => {
    expect(
      runStatus(session(RunPhase.Error, { message: 'gateway refused' })),
    ).toEqual({ integration: 'failed', integrationError: 'gateway refused' });
    expect(
      runStatus(session(RunPhase.Completed, { message: 'stale' }))
        .integrationError,
    ).toBeNull();
  });
});
