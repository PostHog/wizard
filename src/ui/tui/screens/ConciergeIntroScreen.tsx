/**
 * ConciergeIntroScreen — Intro screen for the concierge (read-only) workflow.
 *
 * Placeholder copy only — replace with real copy when the workflow lands.
 */

import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { IntroScreenLayout } from './IntroScreenLayout.js';

interface ConciergeIntroScreenProps {
  store: WizardStore;
}

export const ConciergeIntroScreen = ({ store }: ConciergeIntroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [showingMoreInfo, setShowingMoreInfo] = useState(false);

  const { session } = store;
  const isMainMenu = !showingMoreInfo;

  // ── Body ─────────────────────────────────────────────────────────────

  let body: ReactNode;

  if (showingMoreInfo) {
    body = (
      <Box flexDirection="column" width={56}>
        <Text dimColor>TODO(concierge): more-info body</Text>
      </Box>
    );
  } else {
    body = <Text>TODO(concierge): intro body</Text>;
  }

  // ── Menu ─────────────────────────────────────────────────────────────

  const menuOptions = showingMoreInfo
    ? [{ label: 'Back', value: 'back' }]
    : [
        { label: 'Continue', value: 'continue' },
        { label: 'More info', value: 'more-info' },
        { label: 'Cancel', value: 'cancel' },
      ];

  const handleSelect = (value: string) => {
    if (value === 'cancel') {
      process.exit(0);
    } else if (value === 'more-info') {
      setShowingMoreInfo(true);
    } else if (value === 'back') {
      setShowingMoreInfo(false);
    } else {
      store.completeSetup();
    }
  };

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <IntroScreenLayout
      installDir={session.installDir}
      showSubtitle={!showingMoreInfo}
      body={body}
      showDetection={isMainMenu}
      workflowLabel={session.workflowLabel}
      menuOptions={menuOptions}
      onSelect={handleSelect}
    />
  );
};
