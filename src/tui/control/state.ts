import { projectControlState } from '@programs';
import type { ControlState } from '@shared/control/types';
import { RunPhase } from '@shared/run-state';
import type { TuiState } from '@tui/tui-state';
import type { WizardStore } from '../store.js';

/** The screen answers a parent may read, projected after the session's fields. */
export const CONTROL_TUI_KEYS = [
  'setupConfirmed',
  'integrate',
  'completedRuns',
  'outroDismissed',
  'mcpComplete',
  'slackStepDismissed',
  'skillsComplete',
] as const satisfies readonly (keyof TuiState)[];

/** Project the committed store for a controlling parent; the server adds mode, actions and writes. */
export function projectState(
  store: WizardStore,
  currentScreen: string | null,
): Omit<ControlState, 'mode' | 'actions' | 'controlWrites'> {
  return projectControlState(
    store.sessions,
    currentScreen,
    store.getVersion(),
    Object.fromEntries(CONTROL_TUI_KEYS.map((key) => [key, store[key]])),
  );
}

/** True while an agent run is in flight in this store. */
export function runInFlight(store: WizardStore): boolean {
  return store.session.runPhase === RunPhase.Running;
}
