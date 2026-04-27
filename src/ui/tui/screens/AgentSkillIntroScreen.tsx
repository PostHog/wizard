/**
 * AgentSkillIntroScreen — Intro screen for the generic agent-skill workflow.
 *
 * Main menu: one-liner body, detection rows, continue/cancel.
 * More info: skill name, download URL fetched from the skill menu.
 */

import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { useState, useEffect, useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { IntroScreenLayout } from './IntroScreenLayout.js';
import { fetchSkillMenu, type SkillEntry } from '../../../lib/wizard-tools.js';
import { getSkillsBaseUrl } from '../../../lib/constants.js';

interface AgentSkillIntroScreenProps {
  store: WizardStore;
}

export const AgentSkillIntroScreen = ({
  store,
}: AgentSkillIntroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [showingMoreInfo, setShowingMoreInfo] = useState(false);
  const [skillEntry, setSkillEntry] = useState<SkillEntry | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);

  const { session } = store;
  const skillId = session.skillId ?? 'unknown';
  const isMainMenu = !showingMoreInfo;

  // Fetch skill entry from the menu when more-info is first opened
  useEffect(() => {
    if (!showingMoreInfo || skillEntry || fetchFailed) return;

    const baseUrl = getSkillsBaseUrl(session.localMcp);
    void fetchSkillMenu(baseUrl).then((menu) => {
      if (!menu) {
        setFetchFailed(true);
        return;
      }
      const allSkills = Object.values(menu.categories).flat();
      const match = allSkills.find((s) => s.id === skillId);
      if (match) {
        setSkillEntry(match);
      } else {
        setFetchFailed(true);
      }
    });
  }, [showingMoreInfo, skillEntry, fetchFailed, skillId, session.localMcp]);

  // ── Body ─────────────────────────────────────────────────────────────

  let body: ReactNode;

  if (showingMoreInfo) {
    body = (
      <Box flexDirection="column" width={56} flexShrink={0}>
        <Box flexDirection="column" marginBottom={1}>
          <Text>
            The wizard is an agent that executes PostHog tasks. Its code is open
            source: <Text color="cyan">https://github.com/PostHog/wizard</Text>
          </Text>
        </Box>
        <Text>
          Skill:{' '}
          <Text italic color="cyan">
            {skillEntry?.id ?? skillId}
          </Text>
        </Text>
        <Text>
          URL:{' '}
          <Text color="cyan">
            {skillEntry?.downloadUrl ??
              (fetchFailed ? 'unavailable' : 'Loading...')}
          </Text>
        </Text>
        <Box marginTop={1}>
          <Text dimColor>
            {skillEntry?.name ?? (fetchFailed ? skillId : 'Loading...')}
          </Text>
        </Box>
      </Box>
    );
  } else {
    body = (
      <Text>
        Let's run the{' '}
        <Text italic color="cyan">
          {skillId}
        </Text>{' '}
        skill.
      </Text>
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
      skillId={session.skillId}
      menuOptions={menuOptions}
      onSelect={handleSelect}
    />
  );
};
