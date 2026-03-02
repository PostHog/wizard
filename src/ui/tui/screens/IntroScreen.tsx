/**
 * IntroScreen — Welcome + cloud region picker.
 *
 * Centered layout showing framework detection, description, and region select.
 * Calls store.completeSetup(region) which unblocks bin.ts to start runWizard.
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import type { CloudRegion } from '../../../lib/wizard-session.js';
import { PickerMenu } from '../primitives/index.js';

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
    <Box
      flexDirection="column"
      flexGrow={1}
      alignItems="center"
      justifyContent="center"
    >
      <Box flexDirection="column" alignItems="center" marginBottom={1}>
        <Text bold>
          <Text color="#1D4AFF">{'\u2588'}</Text>
          <Text color="#F54E00">{'\u2588'}</Text>
          <Text color="#F9BD2B">{'\u2588'}</Text> Setup Wizard ready
        </Text>

        {frameworkLabel && (
          <Box marginY={1}>
            <Text>
              <Text color="green">{'\u2714'} </Text>
              <Text>{frameworkLabel}</Text>
            </Text>
          </Box>
        )}

        {config?.metadata.beta && (
          <Text color="yellow">
            [BETA] The {config.metadata.name} wizard is in beta
          </Text>
        )}

        {config?.metadata.preRunNotice && (
          <Text color="yellow">{config.metadata.preRunNotice}</Text>
        )}

        <Text dimColor>
          We'll use AI to analyze your project and integrate PostHog.
        </Text>
        <Text dimColor>.env* file contents will not leave your machine.</Text>
        <Box marginTop={1}>
          <Text>Let's do two hours of work in eight minutes.</Text>
        </Box>
      </Box>

      <PickerMenu<CloudRegion>
        centered
        message="To continue, login: select your PostHog cloud region"
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
