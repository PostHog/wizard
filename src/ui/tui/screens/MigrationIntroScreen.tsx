import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
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
      workflowLabel={session.workflowLabel}
      skillId={session.skillId}
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
