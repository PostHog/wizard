/**
 * IntroScreen — Welcome + cloud region picker.
 *
 * Self-contained: owns the region selection via PickerMenu.
 * Writes to session.cloudRegion and calls store.completeSetup(region)
 * which unblocks bin.ts to start runWizard.
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import type { CloudRegion } from '../../../lib/wizard-session.js';
import { PickerMenu } from '../primitives/index.js';
import { Colors } from '../styles.js';

interface IntroScreenProps {
  store: WizardStore;
}

export const IntroScreen = ({ store }: IntroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.accent}>
          PostHog Setup Wizard
        </Text>
        <Text dimColor>
          We'll use AI to analyze your project and integrate PostHog.
        </Text>
        <Text dimColor>.env* file contents will not leave your machine.</Text>
      </Box>

      <PickerMenu<CloudRegion>
        message="Select your PostHog cloud region"
        options={[
          { label: 'US Cloud', value: 'us', hint: 'us.posthog.com' },
          { label: 'EU Cloud', value: 'eu', hint: 'eu.posthog.com' },
        ]}
        onSelect={(value) => {
          const region = Array.isArray(value) ? value[0] : value;
          store.completeSetup(region);
        }}
      />
    </Box>
  );
};
