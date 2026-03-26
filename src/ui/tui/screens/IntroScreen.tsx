/**
 * IntroScreen — Welcome, framework detection, and continue/cancel prompt.
 *
 * Three states:
 *   1. Detecting: spinner while bin.ts runs detection
 *   2. Detection failed: framework picker, then continue/cancel
 *   3. Detection succeeded: show result, then continue/cancel
 *
 * Calls store.completeSetup() which unblocks bin.ts to start runWizard.
 */

import path from 'path';
import { Box, Text } from 'ink';
import { useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';
import { Integration } from '../../../lib/constants.js';
import { AdditionalFeature } from '../../../lib/wizard-session.js';
import { getCompetitorMigrationOptions } from '../../../lib/discovered-features.js';
import {
  GroupedPickerMenu,
  PickerMenu,
  LoadingBox,
} from '../primitives/index.js';

interface IntroScreenProps {
  store: WizardStore;
}

export const IntroScreen = ({ store }: IntroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [pickingFramework, setPickingFramework] = useState(false);
  const [manuallySelected, setManuallySelected] = useState(false);
  const [migrationSelectionComplete, setMigrationSelectionComplete] =
    useState(false);

  const { session } = store;
  const config = session.frameworkConfig;
  const frameworkLabel =
    session.detectedFrameworkLabel ?? config?.metadata.name;
  const detecting = !session.detectionComplete;
  const needsFrameworkPick =
    session.detectionComplete && !session.frameworkConfig;
  const unsupported = session.unsupportedVersion;
  const migrationOptions = getCompetitorMigrationOptions(
    session.discoveredFeatures,
  );
  const selectedMigrations = migrationOptions.filter((option) =>
    session.additionalFeatureQueue.includes(option.additionalFeature),
  );
  const needsMigrationSelection =
    migrationOptions.length > 0 &&
    session.frameworkConfig !== null &&
    !detecting &&
    !pickingFramework &&
    !unsupported &&
    !migrationSelectionComplete;
  const showContinue =
    session.frameworkConfig !== null &&
    !detecting &&
    !pickingFramework &&
    !unsupported &&
    !needsMigrationSelection;
  const showDescription =
    session.frameworkConfig !== null &&
    !detecting &&
    !pickingFramework &&
    !unsupported;

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
          {detecting ? ' PostHog Wizard starting up' : ' PostHog Wizard 🦔'}
        </Text>

        {showDescription && (
          <Box flexDirection="column" alignItems="center" marginTop={1}>
            <Text dimColor>
              We'll use AI to analyze your project and integrate PostHog.
            </Text>
            <Text dimColor>
              .env* file contents will not leave your machine.
            </Text>
            <Box marginTop={1}>
              <Text>Let's do two hours of work in eight minutes.</Text>
            </Box>
          </Box>
        )}
      </Box>

      {detecting && (
        <Box marginY={1}>
          <LoadingBox message="Detecting project framework..." />
        </Box>
      )}

      {needsFrameworkPick && (
        <Box marginY={1}>
          <Text dimColor>Could not auto-detect your framework.</Text>
        </Box>
      )}

      {config?.metadata.preRunNotice && (
        <Text color="yellow">{config.metadata.preRunNotice}</Text>
      )}

      {(needsFrameworkPick || pickingFramework) && (
        <FrameworkPicker
          store={store}
          onComplete={() => {
            setPickingFramework(false);
            setManuallySelected(true);
          }}
        />
      )}

      {!detecting && !pickingFramework && (
        <Box flexDirection="column">
          <Text>
            <Text>
              Directory <Text color="green">{'\u2714'}</Text>{' '}
            </Text>
            <Text>
              {'/'}
              {path.basename(session.installDir)}{' '}
            </Text>
          </Text>
          {frameworkLabel && (
            <Text>
              <Text>
                Framework <Text color="green">{'\u2714'}</Text>{' '}
              </Text>
              <Text>
                {frameworkLabel}
                {!manuallySelected && ' (detected)'}{' '}
                {config?.metadata.beta && '[BETA]'}
              </Text>
            </Text>
          )}
          {migrationOptions.length > 0 &&
            migrationSelectionComplete &&
            !unsupported && (
              <Text>
                <Text>
                  Queued follow-up work <Text color="green">{'\u2714'}</Text>{' '}
                </Text>
                <Text>
                  {selectedMigrations.length > 0
                    ? selectedMigrations
                        .map((option) => option.label)
                        .join(', ')
                    : 'None'}
                </Text>
              </Text>
            )}
          {unsupported && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="#DC9300">
                Version {unsupported.current} is not supported by the wizard.
                Please upgrade to {unsupported.minimum} or later.
              </Text>
              <Text dimColor>Manual setup guide: {unsupported.docsUrl}</Text>
              <Box marginTop={1}>
                <Text dimColor>
                  Did we get this wrong? You can also select another framework.
                </Text>
              </Box>
              <PickerMenu
                options={[
                  { label: 'Select another framework', value: 'framework' },
                  { label: 'Exit', value: 'exit' },
                ]}
                onSelect={(value) => {
                  const choice = Array.isArray(value) ? value[0] : value;
                  if (choice === 'framework') {
                    setPickingFramework(true);
                    setManuallySelected(true);
                  } else {
                    process.exit(0);
                  }
                }}
              />
            </Box>
          )}
          {needsMigrationSelection && (
            <Box flexDirection="column" marginTop={1}>
              <Text>We found a few existing tools in this project.</Text>
              <Text dimColor>
                Choose any follow-up work you'd like us to queue after the main
                setup finishes.
              </Text>
              <Box marginTop={1}>
                <GroupedPickerMenu
                  message="Which follow-up work should we queue?"
                  groups={{
                    'Optional follow-up work': migrationOptions.map(
                      (option) => ({
                        label: option.label,
                        value: option.additionalFeature,
                        hint: option.hint,
                      }),
                    ),
                  }}
                  initialSelected={selectedMigrations.map(
                    (option) => option.additionalFeature,
                  )}
                  onSelect={(values) => {
                    store.setMigrationFeatures(values as AdditionalFeature[]);
                    setMigrationSelectionComplete(true);
                  }}
                />
              </Box>
            </Box>
          )}
          {showContinue && (
            <PickerMenu
              options={[
                { label: 'Continue', value: 'continue' },
                ...(migrationOptions.length > 0
                  ? [{ label: 'Review selections', value: 'migrations' }]
                  : []),
                { label: 'Change framework', value: 'framework' },
                { label: 'Cancel', value: 'cancel' },
              ]}
              onSelect={(value) => {
                const choice = Array.isArray(value) ? value[0] : value;
                if (choice === 'cancel') {
                  process.exit(0);
                } else if (choice === 'migrations') {
                  setMigrationSelectionComplete(false);
                } else if (choice === 'framework') {
                  setPickingFramework(true);
                  setManuallySelected(true);
                } else {
                  store.completeSetup();
                }
              }}
            />
          )}
        </Box>
      )}
    </Box>
  );
};

/** Framework picker shown when auto-detection fails. */
const FrameworkPicker = ({
  store,
  onComplete,
}: {
  store: WizardStore;
  onComplete?: () => void;
}) => {
  // Build options from the framework registry (loaded dynamically to avoid circular deps)
  const options = Object.values(Integration).map((value) => ({
    label: value,
    value,
  }));

  return (
    <PickerMenu<Integration>
      centered
      columns={2}
      message="Select your framework"
      options={options}
      onSelect={(value) => {
        const integration = Array.isArray(value) ? value[0] : value;
        void import('../../../lib/registry.js').then(
          ({ FRAMEWORK_REGISTRY }) => {
            const config = FRAMEWORK_REGISTRY[integration];
            store.setFrameworkConfig(integration, config);
            store.setDetectedFramework(config.metadata.name);
            onComplete?.();
          },
        );
      }}
    />
  );
};
