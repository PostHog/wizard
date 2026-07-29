/**
 * AgentSkillIntroScreen — Default intro for generic agent-skill programs.
 *
 * Programs that need a different intro ship their own screen component
 * (see audit/AuditIntroScreen.tsx).
 */

import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { IntroScreenLayout } from './IntroScreenLayout.js';
import { SkillSourceInfo, useSkillEntry } from './SkillSourceInfo.js';

interface AgentSkillIntroScreenProps {
  store: WizardStore;
}

export function getAgentSkillIntroTarget(
  skillId: string | null,
  programLabel: string | null,
): { label: string; noun: 'program' | 'skill' } {
  return skillId
    ? { label: skillId, noun: 'skill' }
    : { label: programLabel ?? 'Wizard', noun: 'program' };
}

export const AgentSkillIntroScreen = ({
  store,
}: AgentSkillIntroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [showingMoreInfo, setShowingMoreInfo] = useState(false);

  const { session } = store;
  const skillId = session.skillId;
  const target = getAgentSkillIntroTarget(skillId, session.programLabel);
  const { skillEntry, fetchFailed } = useSkillEntry(skillId, session.localMcp);

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
        {skillId ? (
          <SkillSourceInfo
            skillId={skillId}
            skillEntry={skillEntry}
            fetchFailed={fetchFailed}
          />
        ) : (
          <Text dimColor>
            The program selects the matching Context Mill skill after inspecting
            the app.
          </Text>
        )}
        <Box marginTop={1}>
          <Text dimColor>
            {skillId
              ? skillEntry?.name ?? (fetchFailed ? skillId : 'Loading...')
              : target.label}
          </Text>
        </Box>
      </Box>
    );
  } else {
    body = (
      <Text>
        Let's run the{' '}
        <Text italic color="cyan">
          {target.label}
        </Text>{' '}
        {target.noun}.
      </Text>
    );
  }

  const menuOptions = showingMoreInfo
    ? [{ label: 'Back', value: 'back' }]
    : [
        { label: 'Continue', value: 'continue' },
        { label: 'More info', value: 'more-info' },
        { label: 'Cancel', value: 'cancel' },
      ];

  const handleSelect = (value: string) => {
    if (value === 'cancel') process.exit(0);
    else if (value === 'more-info') setShowingMoreInfo(true);
    else if (value === 'back') setShowingMoreInfo(false);
    else store.completeSetup();
  };

  return (
    <IntroScreenLayout
      installDir={session.installDir}
      showSubtitle={!showingMoreInfo}
      body={body}
      showDetection={!showingMoreInfo}
      programLabel={session.programLabel}
      skillId={session.skillId}
      menuOptions={menuOptions}
      onSelect={handleSelect}
    />
  );
};
