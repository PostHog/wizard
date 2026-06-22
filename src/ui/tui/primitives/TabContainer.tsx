/**
 * TabContainer — Self-contained tabbed interface.
 * Absorbs BottomTabBar + StatusPanel functionality.
 *
 * Key bindings are declared via useKeyBindings, which auto-registers
 * hints in the KeyboardHintsBar (rendered by ScreenContainer).
 */

import { Box, Text } from 'ink';
import { useState, useMemo, type ReactNode } from 'react';
import { Colors, Icons } from '@ui/tui/styles';
import {
  useKeyBindings,
  KeyMatch,
  type KeyBinding,
} from '@ui/tui/hooks/useKeyBindings';
import type { WizardStore } from '@ui/tui/store';
import { COLLAPSED_COUNT, EXPANDED_COUNT } from '@ui/tui/constants';

// Re-exported so existing importers (e.g. LearnCard) keep their path.
export { COLLAPSED_COUNT, EXPANDED_COUNT };

export interface TabDefinition {
  id: string;
  label: string;
  component: ReactNode;
}

interface TabContainerProps {
  tabs: TabDefinition[];
  statusMessage?: string | string[];
  /** Enable expand/collapse on the status box via 's' key */
  expandableStatus?: boolean;
  /** Store reference — required when expandableStatus is true so status state is shared. */
  store?: WizardStore;
}

export const TabContainer = ({
  tabs,
  statusMessage,
  expandableStatus = false,
  store,
}: TabContainerProps) => {
  const [activeTab, setActiveTab] = useState(0);
  // Fallback to local state when no store is provided
  const [localExpanded, setLocalExpanded] = useState(false);

  const statusExpanded = store ? store.statusExpanded : localExpanded;

  const bindings = useMemo<KeyBinding[]>(() => {
    const b: KeyBinding[] = [
      {
        match: [KeyMatch.LeftArrow, KeyMatch.RightArrow],
        label: '\u2190\u2192',
        action: 'switch tab',
        handler: (_input, key) => {
          if (key.leftArrow) {
            setActiveTab((prev) => Math.max(0, prev - 1));
          }
          if (key.rightArrow) {
            setActiveTab((prev) => Math.min(tabs.length - 1, prev + 1));
          }
        },
      },
    ];
    if (expandableStatus) {
      b.push({
        match: 's',
        label: 's',
        action: 'toggle status',
        priority: 12,
        handler: () => {
          if (store) {
            store.toggleStatusExpanded();
          } else {
            setLocalExpanded((prev) => !prev);
          }
        },
      });
    }
    return b;
  }, [tabs.length, expandableStatus, store]);

  useKeyBindings('tab-container', bindings);

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

      {/* Tab bar — wraps onto extra rows when there are more tabs than
          fit the terminal width, instead of clipping the overflow. */}
      <Box height={1} />
      <Box gap={1} paddingX={1} flexWrap="wrap" flexShrink={0}>
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
