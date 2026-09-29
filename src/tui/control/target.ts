import type { ControlTarget } from '@shared/control/types';
import type { WizardStore } from '../store.js';
import { actionsFor } from './actions.js';
import { settersFor } from './setters.js';
import { projectState, runInFlight } from './state.js';

/** A rendered TUI's store as the control server drives it: its router's screen and that screen's actions. */
export function wizardStoreControlTarget(store: WizardStore): ControlTarget {
  return {
    version: () => store.getVersion(),
    subscribe: (listener) => store.subscribe(listener),
    readState: () => projectState(store, store.currentScreen),
    actions: () => {
      const screen = store.currentScreen;
      return screen ? actionsFor(store, screen) : [];
    },
    setters: () => settersFor(store),
    runInFlight: () => runInFlight(store),
    hasApiKey: () => Boolean(store.session.apiKey),
    installDir: () => store.session.installDir,
  };
}
