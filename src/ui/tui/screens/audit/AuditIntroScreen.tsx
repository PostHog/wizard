import { Box, Text } from 'ink';
import { useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { IntroScreenLayout } from '@ui/tui/screens/IntroScreenLayout';
import { SkillSourceInfo, useSkillEntry } from '@ui/tui/screens/SkillSourceInfo';

interface AuditIntroScreenProps {
  store: WizardStore;
}

export const AuditIntroScreen = ({ store }: AuditIntroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [showingMoreInfo, setShowingMoreInfo] = useState(false);
  const { session } = store;
  // bin.ts seeds session.skillId from ProgramConfig.skillId before render,
  // so audit and events-audit pick up their respective skill metadata here.
  const skillId = session.skillId ?? 'audit';
  const { skillEntry, fetchFailed } = useSkillEntry(skillId, session.localMcp);

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
          {skillId}
        </Text>{' '}
        program reviews your project's PostHog integration against best
        practices to help you capture high-quality events and writes a report
        for suggested actions. Nothing in your project will be modified.
      </Text>
      <Box marginTop={1}>
        <SkillSourceInfo
          skillId={skillId}
          skillEntry={skillEntry}
          fetchFailed={fetchFailed}
        />
      </Box>
    </Box>
  ) : (
    <Box flexDirection="column" alignItems="center">
      <Text>Let's review your existing PostHog setup for best practices.</Text>
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
      programLabel={session.programLabel}
      skillId={session.skillId}
      menuOptions={menuOptions}
      onSelect={handleSelect}
    />
  );
};
