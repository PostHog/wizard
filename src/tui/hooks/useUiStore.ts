import { createContext, useContext, useSyncExternalStore } from 'react';
import type { UiStore } from '../ui-store.js';

export const UiStoreContext = createContext<UiStore | null>(null);

/** The presentation store, subscribed; null outside a ScreenContainer. */
export function useUiStore(): UiStore | null {
  const ui = useContext(UiStoreContext);
  useSyncExternalStore(
    (cb) => (ui ? ui.subscribe(cb) : () => undefined),
    () => (ui ? ui.getSnapshot() : 0),
  );
  return ui;
}
