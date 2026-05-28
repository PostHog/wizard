/**
 * WarehouseIntroScreen — Welcome screen for the data warehouse source flow.
 *
 * Composes IntroScreenLayout with detection-specific state:
 *   - Detection succeeded: lists detected sources (grouped by creation mode),
 *     continue/cancel.
 *   - Detection failed: shows the error via errorView + exit prompt.
 *
 * Reads `frameworkContext.detectError` and `frameworkContext.detectedWarehouseSources`
 * set by detectWarehousePrerequisites().
 */

import { Box, Text } from 'ink';
import { useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { PickerMenu } from '@ui/tui/primitives/index';
import { IntroScreenLayout } from './IntroScreenLayout.js';
import type { WarehouseDetectError } from '@lib/programs/warehouse-source/index';
import type { DetectedSource } from '@lib/warehouse-sources/types';

interface WarehouseIntroScreenProps {
  store: WizardStore;
}

export const WarehouseIntroScreen = ({ store }: WarehouseIntroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [showingMoreInfo, setShowingMoreInfo] = useState(false);

  const { session } = store;
  const detectError = session.frameworkContext.detectError as
    | WarehouseDetectError
    | undefined;
  const detected =
    (session.frameworkContext.detectedWarehouseSources as
      | DetectedSource[]
      | undefined) ?? [];

  const inCli = detected.filter((s) => s.mode === 'in-cli');
  const deepLink = detected.filter((s) => s.mode === 'deep-link');

  // ── Body ────────────────────────────────────────────────────────────

  const body = showingMoreInfo ? (
    <Box flexDirection="column" width={56} flexShrink={0}>
      <Text>
        The wizard is an agent that executes PostHog tasks. Its code is open
        source: <Text color="cyan">https://github.com/PostHog/wizard</Text>.
      </Text>
      <Box flexDirection="column" marginTop={1}>
        <Text>
          The{' '}
          <Text italic color="cyan">
            {session.programLabel}
          </Text>{' '}
          program connects your existing data sources to PostHog's data
          warehouse, so you can query them alongside product data.
        </Text>
      </Box>
    </Box>
  ) : (
    <>
      <Box flexDirection="column" alignItems="center">
        <Text>Let's connect your data to PostHog's data warehouse.</Text>
      </Box>

      {detected.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {inCli.length > 0 && (
            <Box flexDirection="column">
              <Text dimColor>Will connect from here:</Text>
              {inCli.map((s) => (
                <Text key={s.kind} dimColor>
                  {'  •'} {s.label} <Text dimColor>({s.matchedSignal})</Text>
                </Text>
              ))}
            </Box>
          )}
          {deepLink.length > 0 && (
            <Box flexDirection="column" marginTop={inCli.length > 0 ? 1 : 0}>
              <Text dimColor>Will open in your browser to finish:</Text>
              {deepLink.map((s) => (
                <Text key={s.kind} dimColor>
                  {'  •'} {s.label} <Text dimColor>({s.matchedSignal})</Text>
                </Text>
              ))}
            </Box>
          )}
        </Box>
      )}
    </>
  );

  // ── Error view ─────────────────────────────────────────────────────

  const errorView = detectError ? (
    <>
      <Box flexDirection="column" marginBottom={1}>
        <Text color="red" bold>
          {'✘'} No data warehouse source detected
        </Text>
        <Box marginTop={1} flexDirection="column">
          <DetectErrorBody error={detectError} />
        </Box>
      </Box>

      <PickerMenu
        options={[{ label: 'Exit', value: 'exit' }]}
        onSelect={() => process.exit(0)}
      />
    </>
  ) : undefined;

  // ── Menu ───────────────────────────────────────────────────────────
  const menuOptions = showingMoreInfo
    ? [{ label: 'Back', value: 'back' }]
    : [
        { label: 'Continue', value: 'continue' },
        { label: 'More info', value: 'more-info' },
        { label: 'Cancel', value: 'cancel' },
      ];

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <IntroScreenLayout
      installDir={session.installDir}
      showSubtitle={!showingMoreInfo}
      body={body}
      showDetection={!showingMoreInfo}
      programLabel={session.programLabel}
      skillId={session.skillId}
      menuOptions={menuOptions}
      errorView={errorView}
      onSelect={(value) => {
        if (value === 'cancel') {
          process.exit(0);
        } else if (value === 'more-info') {
          setShowingMoreInfo(true);
        } else if (value === 'back') {
          setShowingMoreInfo(false);
        } else {
          store.completeSetup();
        }
      }}
    />
  );
};

const DetectErrorBody = ({ error }: { error: WarehouseDetectError }) => {
  switch (error.kind) {
    case 'bad-directory': {
      const reasonText = {
        missing: 'does not exist',
        'not-dir': 'is not a directory',
        unreadable: 'could not be accessed',
      }[error.reason];
      return (
        <>
          <Text>This path {reasonText}:</Text>
          <Text dimColor>
            {'  '}
            {error.path}
          </Text>
        </>
      );
    }

    case 'no-sources':
      return (
        <>
          <Text>No supported data source was detected in this project.</Text>
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>
              The wizard looks for databases (Postgres, MySQL, MongoDB, …) and
              API-key sources like Stripe in your dependencies and .env keys.
            </Text>
            <Text dimColor>
              Run this command from your project root, or set a source up
              directly at{' '}
              <Text color="cyan">https://posthog.com/docs/data-warehouse</Text>.
            </Text>
          </Box>
        </>
      );
  }
};
