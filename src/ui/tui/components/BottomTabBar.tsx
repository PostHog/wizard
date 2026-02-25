import { Box, Text, useInput } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';

interface BottomTabBarProps {
  store: WizardStore;
}

export const BottomTabBar = ({ store }: BottomTabBarProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  useInput((_input, key) => {
    if (!store.showTabBar) return;
    if (key.leftArrow) {
      store.setActiveTab(Math.max(0, store.activeTab - 1));
    }
    if (key.rightArrow) {
      store.setActiveTab(Math.min(store.tabs.length - 1, store.activeTab + 1));
    }
  });

  if (!store.showTabBar) {
    return null;
  }

  return (
    <Box gap={1} paddingX={1}>
      {store.tabs.map((tab, i) => (
        <Text
          key={tab.id}
          inverse={i === store.activeTab}
          color={i === store.activeTab ? 'yellow' : 'gray'}
          bold={i === store.activeTab}
        >
          {` ${tab.label} `}
        </Text>
      ))}
    </Box>
  );
};
