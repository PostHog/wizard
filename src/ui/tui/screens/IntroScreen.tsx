/**
 * IntroScreen — Welcome, framework detection, and cloud region picker.
 *
 * Three states:
 *   1. Detecting: spinner while bin.ts runs detection
 *   2. Detection failed: framework picker, then region picker
 *   3. Detection succeeded: show result, then region picker
 *
 * Calls store.completeSetup(region) which unblocks bin.ts to start runWizard.
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import type { CloudRegion } from '../../../lib/wizard-session.js';
import { Integration } from '../../../lib/constants.js';
import { PickerMenu, LoadingBox } from '../primitives/index.js';

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
  const detecting = !session.detectionComplete;
  const needsFrameworkPick =
    session.detectionComplete && !session.frameworkConfig;
  const showRegionPicker = session.frameworkConfig !== null && !detecting;
  const showDescription = showRegionPicker;

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
          <Text color="#F9BD2B">{'\u2588'}</Text>
          {detecting ? ' Setup Wizard starting up' : ' Setup Wizard ready'}
        </Text>

        {detecting && (
          <Box marginY={1}>
            <LoadingBox message="Detecting project framework..." />
          </Box>
        )}

        {frameworkLabel && !detecting && (
          <Box marginY={1}>
            <Text>
              <Text color="green">{'\u2714'} </Text>
              <Text>{frameworkLabel}</Text>
            </Text>
          </Box>
        )}

        {needsFrameworkPick && (
          <Box marginY={1}>
            <Text dimColor>Could not auto-detect your framework.</Text>
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

        {showDescription && (
          <>
            <Text dimColor>
              We'll use AI to analyze your project and integrate PostHog.
            </Text>
            <Text dimColor>
              .env* file contents will not leave your machine.
            </Text>
            <Box marginTop={1}>
              <Text>Let's do two hours of work in eight minutes.</Text>
            </Box>
          </>
        )}
      </Box>

      {needsFrameworkPick && <FrameworkPicker store={store} />}

      {showRegionPicker && (
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
      )}
    </Box>
  );
};

/** Framework picker shown when auto-detection fails. */
const FrameworkPicker = ({ store }: { store: WizardStore }) => {
  // Build options from the framework registry (loaded dynamically to avoid circular deps)
  const options = Object.values(Integration).map((value) => ({
    label: value,
    value,
  }));

  return (
    <PickerMenu<Integration>
      centered
      message="Select your framework"
      options={options}
      onSelect={(value) => {
        const integration = Array.isArray(value) ? value[0] : value;
        void import('../../../lib/registry.js').then(
          ({ FRAMEWORK_REGISTRY }) => {
            const config = FRAMEWORK_REGISTRY[integration];
            store.setFrameworkConfig(integration, config);
            store.setDetectedFramework(config.metadata.name);
          },
        );
      }}
    />
  );
};
