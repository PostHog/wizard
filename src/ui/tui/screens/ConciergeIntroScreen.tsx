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
      <Box flexDirection="column" width={64}>
        <Text>
          A concierge investigation is a read-only inquiry into a single
          question Mr. Christophe is curious about — typically a funnel,
          retention, or experiment matter.
        </Text>
        <Box marginTop={1}>
          <Text>
            With your permission I shall: read the saved insights and dashboards
            already in your project; query for cohort and timing signals; layer
            in qualitative evidence such as session replays, surveys, and error
            tracking; and prepare two outputs — a PostHog notebook for the next
            conversation, and a concise local report (a markdown file for LLMs)
            for any agent that follows.
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Nothing in your local files shall be altered.</Text>
        </Box>
      </Box>
    );
  } else {
    body = (
      <Box flexDirection="column" width={64}>
        <Text>
          Mr. Christophe has entrusted me with a concierge investigation for
          you.
        </Text>
        <Box marginTop={1}>
          <Text>
            I shall examine your PostHog project, prepare a notebook with my
            findings, and leave a brief dossier for any successor (a markdown
            file for LLMs) — all without modifying your local files.
          </Text>
        </Box>
      </Box>
    );
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
