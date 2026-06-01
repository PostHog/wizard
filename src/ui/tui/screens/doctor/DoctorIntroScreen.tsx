import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { PickerMenu } from '@ui/tui/primitives/index';
import { Colors, Icons } from '@ui/tui/styles';

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
