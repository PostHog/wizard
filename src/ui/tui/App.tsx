import { useMemo } from 'react';
import { ScreenContainer } from './primitives/index.js';
import type { WizardStore } from './store.js';
import { createScreens, createServices } from './screen-registry.js';

interface AppProps {
  store: WizardStore;
}

export const App = ({ store }: AppProps) => {
  const services = useMemo(() => createServices(), []);
  const screens = useMemo(
    () => createScreens(store, services),
    [store, services],
  );

  return <ScreenContainer store={store} screens={screens} />;
};
