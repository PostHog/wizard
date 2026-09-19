import { RunPhase } from '@store';
import type { ControlState } from '@store/types';

const RUN_STATUS: Record<RunPhase, string> = {
  [RunPhase.Idle]: 'idle',
  [RunPhase.Running]: 'running',
  [RunPhase.Completed]: 'done',
  [RunPhase.Error]: 'failed',
};

/** The MCP route's background run status, read off the store's run phase. */
export function runStatus(
  session: Pick<
    ControlState['session'],
    'runPhase' | 'runRequested' | 'outroData'
  >,
): { integration: string; integrationError: string | null } {
  const armed = session.runPhase === RunPhase.Idle && session.runRequested;
  return {
    integration: armed ? 'running' : RUN_STATUS[session.runPhase],
    integrationError:
      session.runPhase === RunPhase.Error
        ? session.outroData?.message ?? null
        : null,
  };
}

/** `read_state` adds the run status under its historical names. */
export function withRunStatus(state: ControlState): Record<string, unknown> {
  return { ...state, ...runStatus(state.session) };
}
