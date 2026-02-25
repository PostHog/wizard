/**
 * RunScreen — Tabbed layout for the agent run phase.
 * Manages tabs internally; renders BottomTabBar as a child.
 */

import { Box } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { getTabs } from '../tabs/tab-registry.js';
import { BottomTabBar } from '../components/BottomTabBar.js';
import { StatusPanel } from '../components/StatusPanel.js';

interface RunScreenProps {
  store: WizardStore;
}

export const RunScreen = ({ store }: RunScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const tabs = getTabs();
  const activeTabConfig = tabs[store.activeTab];
  const TabComponent = activeTabConfig?.component;

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" flexGrow={1}>
        {TabComponent ? <TabComponent store={store} /> : null}
      </Box>
      <StatusPanel store={store} />
      <BottomTabBar store={store} />
    </Box>
  );
};
