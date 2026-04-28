import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../../store.js';
import { PickerMenu } from '../../primitives/index.js';
import { Colors, Icons } from '../../styles.js';

interface DoctorIntroScreenProps {
  store: WizardStore;
}

export const DoctorIntroScreen = ({ store }: DoctorIntroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.accent}>
          PostHog Doctor
        </Text>
        <Text dimColor>
          Scan your project configuration for issues that may need attention.
        </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text>The wizard will:</Text>
        <Box paddingLeft={2} flexDirection="column">
          <Text>{Icons.bullet} Sign you in to PostHog</Text>
          <Text>
            {Icons.bullet} Fetch active health issues for your project
          </Text>
          <Text>
            {Icons.bullet} Show you what needs to be resolved, with docs links
          </Text>
        </Box>
      </Box>

      <PickerMenu
        options={[
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
    </Box>
  );
};
