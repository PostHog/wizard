import { Box, useStdout } from 'ink';
import { useSyncExternalStore } from 'react';
import { TitleBar } from './components/TitleBar.js';
import { Modal } from './components/Modal.js';
import { getScreenComponent } from './screens/screen-registry.js';
import type { WizardStore } from './store.js';

const MIN_WIDTH = 80;
const MAX_WIDTH = 120;

interface AppProps {
  store: WizardStore;
}

export const App = ({ store }: AppProps) => {
  const { stdout } = useStdout();
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, stdout.columns));
  const ScreenComponent = getScreenComponent(store.currentScreen);

  return (
    <Box flexDirection="column" height={stdout.rows} width={width}>
      <TitleBar version={store.version} />
      <Box height={1} />
      <Box flexDirection="column" flexGrow={1}>
        {store.modalPrompt && <Modal store={store} />}
        {ScreenComponent && <ScreenComponent store={store} />}
      </Box>
    </Box>
  );
};
