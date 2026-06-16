import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { IntroScreenLayout } from './IntroScreenLayout.js';

interface MigrationIntroScreenProps {
  store: WizardStore;
}

export const MigrationIntroScreen = ({ store }: MigrationIntroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const { session } = store;

  const body = (
    <Box flexDirection="column" alignItems="center">
      <Text>Let's migrate this project to PostHog.</Text>
    </Box>
  );

  return (
    <IntroScreenLayout
      installDir={session.installDir}
      body={body}
      programLabel={session.programLabel}
      skillId={session.skillId}
      detectionRows={
        session.skillId
          ? [{ label: 'Skill', value: session.skillId }]
          : undefined
      }
      menuOptions={[
        { label: 'Continue', value: 'continue' },
        { label: 'Cancel', value: 'cancel' },
      ]}
      onSelect={(value) => {
        if (value === 'cancel') {
          process.exit(0);
        } else {
          store.completeSetup();
        }
      }}
    />
  );
};
