import type { ControlTarget } from '@shared/control/types';
import type { WizardStore } from '../store.js';
import { actionsFor } from './actions.js';
import { settersFor } from './setters.js';
import { projectState, runInFlight } from './state.js';

/**
 * A WizardStore as the control server drives it. `screens` says whether the
 * current screen means anything: a rendered TUI answers with its router's
 * screen and that screen's actions; a headless store that never renders
 * answers with the overlays it can raise (a pending question or task notice).
 */
export function wizardStoreControlTarget(
  store: WizardStore,
  { screens }: { screens: boolean },
): ControlTarget {
  const currentScreen = (): string | null => {
    if (screens) return store.currentScreen;
    if (store.session.pendingQuestion) return 'wizard-ask';
    if (store.session.taskNotice) return 'task-notice';
    return null;
  };
  return {
    version: () => store.getVersion(),
    subscribe: (listener) => store.subscribe(listener),
    readState: () => projectState(store, currentScreen()),
    actions: () => {
      const screen = currentScreen();
      return screen ? actionsFor(store, screen) : [];
    },
    setters: () => settersFor(store),
    runInFlight: () => runInFlight(store),
    hasApiKey: () => Boolean(store.session.apiKey),
    installDir: () => store.session.installDir,
  };
}
