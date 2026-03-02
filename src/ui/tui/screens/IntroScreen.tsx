/**
 * IntroScreen — Welcome + cloud region picker.
 *
 * Shows detected framework info and beta notices from session state.
 * Calls store.completeSetup(region) which unblocks bin.ts to start runWizard.
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

  const { session } = store;
  const config = session.frameworkConfig;
  const frameworkLabel =
    session.detectedFrameworkLabel ?? config?.metadata.name;

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={Colors.accent}>
          PostHog Setup Wizard
        </Text>

        {frameworkLabel && (
          <Text>
            <Text color="green">{'\u2714'} </Text>
            <Text>Detected: {frameworkLabel}</Text>
          </Text>
        )}

        {config?.metadata.beta && (
          <Text color="yellow">
            [BETA] The {config.metadata.name} wizard is in beta. Questions or
            feedback? Email wizard@posthog.com
          </Text>
        )}

        {config?.metadata.preRunNotice && (
          <Text color="yellow">{config.metadata.preRunNotice}</Text>
        )}

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
