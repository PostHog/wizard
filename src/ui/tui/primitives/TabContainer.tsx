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

const COLLAPSED_COUNT = 2;
const EXPANDED_COUNT = 10;

interface TabContainerProps {
  tabs: TabDefinition[];
  statusMessage?: string | string[];
  /** Enable expand/collapse on the status box via 's' key */
  expandableStatus?: boolean;
}

export const TabContainer = ({
  tabs,
  statusMessage,
  expandableStatus = false,
}: TabContainerProps) => {
  const [activeTab, setActiveTab] = useState(0);
  const [statusExpanded, setStatusExpanded] = useState(false);

  useInput((input, key) => {
    if (key.leftArrow) {
      setActiveTab((prev) => Math.max(0, prev - 1));
    }
    if (key.rightArrow) {
      setActiveTab((prev) => Math.min(tabs.length - 1, prev + 1));
    }
    if (expandableStatus && input === 's') {
      setStatusExpanded((prev) => !prev);
    }
  });

  const current = tabs[activeTab];

  const allMessages = statusMessage
    ? Array.isArray(statusMessage)
      ? statusMessage
      : [statusMessage]
    : [];
  const visibleCount =
    expandableStatus && statusExpanded ? EXPANDED_COUNT : COLLAPSED_COUNT;
  const visibleMessages = allMessages.slice(-visibleCount);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Active tab content — overflow hidden so expanded status eats into this area */}
      <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
        {current?.component}
      </Box>

      {/* Status bar */}
      {visibleMessages.length > 0 && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderTop
          borderBottom={false}
          borderLeft={false}
          borderRight={false}
          borderColor={Colors.muted}
          paddingX={1}
          overflow="hidden"
        >
          {visibleMessages.map((msg, i, arr) => {
            const isCurrent = i === arr.length - 1;
            return (
              <Text key={i} color={Colors.muted} dimColor={!isCurrent}>
                {isCurrent ? Icons.diamond : '\u250A'} {msg}
              </Text>
            );
          })}
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
