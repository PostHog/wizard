// run-bridge (used by driveStream's bridge) loads AgentErrorType through
// agent-interface; stub it so the test stays a focused unit.
jest.mock('../../../agent-interface', () => ({
  AgentErrorType: {
    RATE_LIMIT: 'WIZARD_RATE_LIMIT',
    API_ERROR: 'WIZARD_API_ERROR',
  },
}));

import { driveStream, type RunEvent } from '../run-loop';
import { RunBridge, type BridgeUI, type BridgeSpinner } from '../run-bridge';

const noopUI: BridgeUI = {
  pushStatus: () => undefined,
  setDashboardUrl: () => undefined,
  setNotebookUrl: () => undefined,
  syncTodos: () => undefined,
};
const noopSpinner: BridgeSpinner = { message: () => undefined };

// eslint-disable-next-line @typescript-eslint/require-await -- test helper replays a fixed list as an async stream
async function* stream(events: RunEvent[]): AsyncGenerator<RunEvent> {
  for (const event of events) yield event;
}

describe('driveStream', () => {
  it('feeds assistant text to the bridge without aborting on a clean run', async () => {
    const bridge = new RunBridge(noopUI, noopSpinner);
    let aborted = false;
    const error = await driveStream(
      stream([{ kind: 'assistantText', text: 'all good' }]),
      bridge,
      () => {
        aborted = true;
      },
    );
    expect(error).toBeUndefined();
    expect(aborted).toBe(false);
  });

  it('aborts the loop on the first [ABORT] marker', async () => {
    const bridge = new RunBridge(noopUI, noopSpinner);
    let aborted = false;
    await driveStream(
      stream([
        { kind: 'assistantText', text: 'cannot continue\n[ABORT] no key' },
      ]),
      bridge,
      () => {
        aborted = true;
      },
    );
    expect(aborted).toBe(true);
    expect(bridge.abort).toBe('no key');
  });

  it('returns a yielded stream error', async () => {
    const bridge = new RunBridge(noopUI, noopSpinner);
    const boom = new Error('boom');
    const error = await driveStream(
      stream([{ kind: 'error', error: boom }]),
      bridge,
      () => undefined,
    );
    expect(error).toBe(boom);
  });
});
