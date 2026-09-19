import type { RunAgent } from '@agent/types';
import { StoreUI, FlowStore, setUI } from '@store';
import { flowFor } from '@store/programs';
import type { ProgramId } from '@store/types';
import type { TuiHandle } from '@tui/types';

export interface RunAgentCall {
  programId: string;
  installDir: string;
  frameworkContextKeys: string[];
  skillId: string | null;
  composed: boolean;
}

/** A RunAgent that records what each independent run received. */
export function fakeRunAgent(): { runAgent: RunAgent; calls: RunAgentCall[] } {
  const calls: RunAgentCall[] = [];
  const runAgent: RunAgent = (config, session, options = {}) => {
    calls.push({
      programId: config.id,
      installDir: session.installDir,
      frameworkContextKeys: Object.keys(session.frameworkContext),
      skillId: session.skillId,
      composed: options.composed ?? false,
    });
    return Promise.resolve();
  };
  return { runAgent, calls };
}

/** A real store behind StoreUI, no Ink: what startTUI hands the runner. */
export function fakeStartTUI(programId: ProgramId): TuiHandle {
  const store = new FlowStore(flowFor(programId).flow);
  setUI(new StoreUI(store));
  return {
    store,
    unmount: () => undefined,
    waitForSetup: () => Promise.resolve(),
  };
}
