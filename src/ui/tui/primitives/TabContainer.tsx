/**
 * TabContainer — Self-contained tabbed interface.
 *
 * Tab content renders inline (ScreenContainer wraps it with the hints bar).
 * Navigation chrome (status bar + tab bar) is pushed to ScreenContainer
 * via NavChromeContext so it renders below the hints bar.
 */

import { Box, Text } from 'ink';
import { useState, useMemo, useEffect, type ReactNode } from 'react';
import { Colors, Icons } from '../styles.js';
import {
  useKeyBindings,
  KeyMatch,
  type KeyBinding,
} from '../hooks/useKeyBindings.js';
import { useNavChrome } from './ScreenContainer.js';
import type { WizardStore } from '../store.js';

export interface TabDefinition {
  id: string;
  label: string;
  component: ReactNode;
}

export const COLLAPSED_COUNT = 2;
export const EXPANDED_COUNT = 10;

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
  const [localExpanded, setLocalExpanded] = useState(false);
  const navChrome = useNavChrome();
  const setNavChrome = (node: ReactNode) => navChrome.setNavChrome(node);
  const clearNavChrome = () => navChrome.clearNavChrome();

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

  // Push nav chrome to ScreenContainer
  useEffect(() => {
    setNavChrome(
      <Box flexDirection="column">
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
      </Box>,
    );
    return clearNavChrome;
  }, [activeTab, visibleMessages, tabs, setNavChrome, clearNavChrome]);

  // Just render tab content — ScreenContainer handles the rest
  return (
    <Box flexDirection="column" flexGrow={1}>
      {current?.component}
    </Box>
  );
};
