import { ScreenContainer } from './primitives/index.js';
import type { WizardStore } from './store.js';
import { OutageScreen } from './screens/OutageScreen.js';
import { IntroScreen } from './screens/IntroScreen.js';
import { RunScreen } from './screens/RunScreen.js';
import { McpScreen } from './screens/McpScreen.js';
import { OutroScreen } from './screens/OutroScreen.js';

interface AppProps {
  store: WizardStore;
}

export const App = ({ store }: AppProps) => {
  return (
    <ScreenContainer
      store={store}
      screens={{
        outage: <OutageScreen store={store} />,
        intro: <IntroScreen store={store} />,
        run: <RunScreen store={store} />,
        mcp: <McpScreen store={store} />,
        outro: <OutroScreen store={store} />,
      }}
    />
  );
};
