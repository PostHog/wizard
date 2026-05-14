import { Box, Text } from 'ink';
import { useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '../../store.js';
import { IntroScreenLayout } from '../IntroScreenLayout.js';
import { SkillSourceInfo, useSkillEntry } from '../SkillSourceInfo.js';

const AUDIT3000_SKILL_ID = 'audit-3000';

interface Audit3000IntroScreenProps {
  store: WizardStore;
}

export const Audit3000IntroScreen = ({ store }: Audit3000IntroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [showingMoreInfo, setShowingMoreInfo] = useState(false);
  const { session } = store;
  const { skillEntry, fetchFailed } = useSkillEntry(
    AUDIT3000_SKILL_ID,
    session.localMcp,
  );

  const body = showingMoreInfo ? (
    <Box flexDirection="column" width={56}>
      <Box marginBottom={1}>
        <Text>
          The wizard is an agent that executes PostHog tasks. Its code is open
          source: <Text color="cyan">https://github.com/PostHog/wizard</Text>
        </Text>
      </Box>

      <Text>
        The{' '}
        <Text color="cyan" italic>
          {AUDIT3000_SKILL_ID}
        </Text>{' '}
        workflow reviews your PostHog integration against best practices — SDK
        install, identification, event capture, event quality, and stale
        feature-flag hygiene — and writes a report with suggested actions. When
        enrichment is available, it also produces a separate company profile +
        use-case match. Nothing in your project is modified.
      </Text>
      <Box marginTop={1}>
        <SkillSourceInfo
          skillId={AUDIT3000_SKILL_ID}
          skillEntry={skillEntry}
          fetchFailed={fetchFailed}
        />
      </Box>
    </Box>
  ) : (
    <Box flexDirection="column" alignItems="center">
      <Text>
        Let's run a deep review of your PostHog setup and surface concrete next
        steps.
      </Text>
    </Box>
  );

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
      body={body}
      showDetection={!showingMoreInfo}
      workflowLabel={session.workflowLabel}
      skillId={session.skillId}
      menuOptions={menuOptions}
      onSelect={handleSelect}
    />
  );
};
