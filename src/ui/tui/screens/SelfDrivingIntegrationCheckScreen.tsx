/**
 * SelfDrivingIntegrationCheckScreen — shown only when detection found no
 * PostHog in the project. It's a notice, not a question: Self-driving requires
 * a PostHog SDK, so the single action sets `integrate = true` and the run
 * integrates first. Skipped entirely when PostHog is already present (or under
 * `--integrate`).
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';

import type { WizardStore } from '@ui/tui/store';
import { PickerMenu } from '@ui/tui/primitives/index';
import { Colors } from '@ui/tui/styles';

interface SelfDrivingIntegrationCheckScreenProps {
  store: WizardStore;
}

export const SelfDrivingIntegrationCheckScreen = ({
  store,
}: SelfDrivingIntegrationCheckScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color={Colors.accent}>
        No PostHog integration found
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          This will kick off an agent to explore your project and 
          find existing PostHog integrations.
          
          Self-driving reads PostHog data, so we&apos;ll 
          set that up first: it gives your signal
          sources something to watch.
        </Text>
      </Box>

      <Box marginTop={1}>
        <PickerMenu
          options={[{ label: 'Set up PostHog [Enter]', value: 'yes' }]}
          onSelect={() => store.setIntegrate(true)}
        />
      </Box>
    </Box>
  );
};
