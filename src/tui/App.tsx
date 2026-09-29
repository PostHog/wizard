import { useMemo } from 'react';
import { ScreenContainer } from './primitives/index.js';
import type { WizardStore } from '../ui/tui/store.js';
import { createScreens, createServices } from '../ui/tui/screen-registry.js';

interface AppProps {
  store: WizardStore;
}

export const App = ({ store }: AppProps) => {
  const services = useMemo(() => createServices(store), [store]);
  const screens = useMemo(
    () => createScreens(store, services),
    [store, services],
  );

  return <ScreenContainer store={store} screens={screens} />;
};
