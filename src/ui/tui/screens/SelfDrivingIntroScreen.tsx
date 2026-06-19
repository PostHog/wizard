/**
 * SelfDrivingIntroScreen — Welcome screen for the self-driving flow.
 *
 * Composes IntroScreenLayout with prerequisite-detection state:
 *   - Detection succeeded: explains what Self-driving turns on, continue/cancel
 *   - Detection failed: shows the error via errorView + exit prompt
 *
 * Reads `frameworkContext.detectError` set by
 * detectSelfDrivingPrerequisites().
 */

import { Box, Text } from 'ink';
import { useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { PickerMenu } from '@ui/tui/primitives/index';
import { IntroScreenLayout } from './IntroScreenLayout.js';
import type { SelfDrivingDetectError } from '@lib/programs/self-driving/index';

interface SelfDrivingIntroScreenProps {
  store: WizardStore;
}

export const SelfDrivingIntroScreen = ({
  store,
}: SelfDrivingIntroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [showingMoreInfo, setShowingMoreInfo] = useState(false);

  const { session } = store;
  const detectError = session.frameworkContext.detectError as
    | SelfDrivingDetectError
    | undefined;

  const subtitle = (
    <>
      <Text dimColor>
        We'll use AI to analyze your project and set up PostHog Self-driving.
      </Text>
      <Text dimColor>.env* file contents will not leave your machine.</Text>
    </>
  );

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
          program turns on PostHog Self-driving for this project:
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1} paddingLeft={4}>
        <Text>{'•'} Watches errors, replays, and connected tools</Text>
        <Text>{'•'} Runs scouts — scheduled checks that scan for issues</Text>
        <Text>{'•'} Researches findings in your code via GitHub</Text>
        <Text>{'•'} Surfaces everything in your Self-driving inbox</Text>
      </Box>
    </Box>
  ) : (
    <Box flexDirection="column" alignItems="center">
      <Text>Let's set up PostHog Self-driving.</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text>PostHog finds — and can fix — issues in your product.</Text>
      </Box>
      <Box flexDirection="column" marginTop={1} alignItems="center">
        <Text dimColor>
          It turns on signal sources (errors, replays, connected tools)
        </Text>
        <Text dimColor>
          and scouts — scheduled checks that flag issues to your inbox.
        </Text>
      </Box>
    </Box>
  );

  const errorView = detectError ? (
    <>
      <Box flexDirection="column" marginBottom={1}>
        <Text color="red" bold>
          {'✘'} Cannot set up PostHog Self-driving
        </Text>
        <Box marginTop={1} flexDirection="column">
          <DetectErrorBody error={detectError} />
        </Box>
      </Box>

      <PickerMenu
        options={[{ label: 'Exit', value: 'exit' }]}
        onSelect={() => process.exit(1)}
      />
    </>
  ) : undefined;

  const menuOptions = showingMoreInfo
    ? [{ label: 'Back', value: 'back' }]
    : [
        { label: 'Continue', value: 'continue' },
        { label: 'More info', value: 'more-info' },
        { label: 'Cancel', value: 'cancel' },
      ];

  return (
    <IntroScreenLayout
      installDir={session.installDir}
      showSubtitle={!showingMoreInfo}
      subtitle={subtitle}
      body={body}
      showDetection={!showingMoreInfo}
      errorView={errorView}
      programLabel={session.programLabel}
      skillId={session.skillId}
      menuOptions={menuOptions}
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

const DetectErrorBody = ({ error }: { error: SelfDrivingDetectError }) => {
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

    default:
      // Defensive fallback so a future SelfDrivingDetectError kind still
      // renders something useful instead of a blank screen.
      return (
        <Text>
          Self-driving could not start in this directory. Try again, or reach
          out to wizard@posthog.com.
        </Text>
      );
  }
};
