import type { WizardStore } from '../state/store.js';
import { actionsFor, toActionView, UnknownActionError } from './actions.js';
import { projectState } from './state.js';
import type { ActionView, ControlState, RunStatus } from './types.js';

/**
 * Read and act on one store. Reads the committed state; acts through the exact
 * setter the screen's keyboard handler would call. In-progress keystroke state
 * is React-local and invisible here by design.
 */
export class ControlDriver {
  constructor(
    private readonly store: WizardStore,
    private readonly run: () => { status: RunStatus; error: string | null },
  ) {}

  readState(): ControlState {
    return projectState(this.store, this.run());
  }

  listActions(): ActionView[] {
    return actionsFor(this.store.flow, this.store.currentScreen).map(
      toActionView,
    );
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

  /**
   * Resolve on the first commit with `version > since`, or after `timeoutMs`
   * with whatever is current. Every commit bumps the version, including the
   * agent's `getUI()` calls, so a parent can block instead of poll.
   */
  waitForVersion(since: number, timeoutMs: number): Promise<ControlState> {
    if (this.store.getVersion() > since)
      return Promise.resolve(this.readState());
    return new Promise<ControlState>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsub();
        resolve(this.readState());
      };
      const timer = setTimeout(finish, timeoutMs);
      const unsub = this.store.subscribe(() => {
        if (this.store.getVersion() > since) finish();
      });
    });
  }
}
