/**
 * TabContainer — Self-contained tabbed interface.
 * Absorbs BottomTabBar + StatusPanel functionality.
 */

import { Box, Text, useInput } from 'ink';
import { useState, type ReactNode } from 'react';
import { Colors, Icons } from '../styles.js';

export interface TabDefinition {
  id: string;
  label: string;
  component: ReactNode;
}

interface TabContainerProps {
  tabs: TabDefinition[];
  statusMessage?: string;
}

export const TabContainer = ({ tabs, statusMessage }: TabContainerProps) => {
  const [activeTab, setActiveTab] = useState(0);

  useInput((_input, key) => {
    if (key.leftArrow) {
      setActiveTab((prev) => Math.max(0, prev - 1));
    }
    if (key.rightArrow) {
      setActiveTab((prev) => Math.min(tabs.length - 1, prev + 1));
    }
  });

  const current = tabs[activeTab];

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Active tab content */}
      <Box flexDirection="column" flexGrow={1}>
        {current?.component}
      </Box>

      {/* Status bar */}
      {statusMessage && (
        <Box
          borderStyle="single"
          borderTop
          borderBottom={false}
          borderLeft={false}
          borderRight={false}
          borderColor={Colors.muted}
          paddingX={1}
          overflow="hidden"
        >
          <Text color={Colors.muted}>
            {Icons.diamondOpen} {statusMessage}
          </Text>
        </Box>
      )}

      {/* Tab bar */}
      <Box height={1} />
      <Box gap={1} paddingX={1}>
        {tabs.map((tab, i) => (
          <Text
            key={tab.id}
            inverse={i === activeTab}
            color={i === activeTab ? Colors.accent : Colors.muted}
            bold={i === activeTab}
          >
            {` ${tab.label} `}
          </Text>
        ))}
      </Box>
    </Box>
  );
};
