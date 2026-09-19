import { useMemo } from 'react';
import { ScreenContainer } from './primitives/index.js';
import type { WizardStore } from '@store/state/store';
import type { UiStore } from './ui-store.js';
import { createScreens, createServices } from './screen-registry.js';

interface AppProps {
  store: WizardStore;
  ui: UiStore;
}

export const App = ({ store, ui }: AppProps) => {
  const services = useMemo(() => createServices(store), [store]);
  const screens = useMemo(
    () => createScreens(store, services),
    [store, services],
  );

  return <ScreenContainer store={store} ui={ui} screens={screens} />;
};
