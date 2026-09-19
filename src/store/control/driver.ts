import type { FlowStore } from '../state/store.js';
import { actionsFor, UnknownActionError } from './actions.js';
import { projectState } from './state.js';
import type { ControlState } from './types.js';

/** Reads the committed store and acts through the setter the screen's key handler would call. */
export class ControlDriver {
  constructor(private readonly store: FlowStore) {}

  readState(): ControlState {
    return projectState(this.store);
  }

  /** Apply a named action on the current screen; 400-class errors throw. */
  performAction(
    actionId: string,
    params: Record<string, unknown> = {},
  ): ControlState {
    const screen = this.store.currentScreen;
    const action = actionsFor(this.store.flow, screen).find(
      (a) => a.id === actionId,
    );
    if (!action) throw new UnknownActionError(actionId, screen);
    action.apply(this.store, params);
    return this.readState();
  }

  /** Resolve on the first commit past `since`, on `timeoutMs`, or when `signal` aborts. */
  waitForVersion(
    since: number,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<ControlState> {
    if (this.store.getVersion() > since || signal?.aborted) {
      return Promise.resolve(this.readState());
    }
    return new Promise<ControlState>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsub();
        signal?.removeEventListener('abort', finish);
        resolve(this.readState());
      };
      const timer = setTimeout(finish, timeoutMs);
      const unsub = this.store.subscribe(() => {
        if (this.store.getVersion() > since) finish();
      });
      signal?.addEventListener('abort', finish, { once: true });
    });
  }
}
