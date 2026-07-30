import { Box, Text } from 'ink';
import { useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { IntroScreenLayout } from './IntroScreenLayout.js';

interface FeatureFlagsIntroScreenProps {
  store: WizardStore;
}

export const FeatureFlagsIntroScreen = ({
  store,
}: FeatureFlagsIntroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [showingMoreInfo, setShowingMoreInfo] = useState(false);
  const { session } = store;

  const subtitle = (
    <>
      <Text dimColor>
        We'll use AI to inspect your project and propose one product change to
        place behind a PostHog feature flag.
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
            feature-flags
          </Text>{' '}
          program:
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1} paddingLeft={4}>
        <Text>{'\u2022'} Uses the PostHog SDK already in your project</Text>
        <Text>
          {'\u2022'} Finds an existing product change and proposes a flag
        </Text>
        <Text>{'\u2022'} Waits for your approval before changing anything</Text>
        <Text>
          {'\u2022'} Creates or reuses a real flag with a safe rollout
        </Text>
        <Text>
          {'\u2022'} Checks both experiences and writes a setup report
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          After inspecting the app, the program selects the matching
          framework-specific Context Mill skill.
        </Text>
      </Box>
    </Box>
  ) : (
    <Box flexDirection="column" alignItems="center">
      <Text>Ship a change without releasing it to everyone.</Text>
      <Box flexDirection="column" marginTop={1} alignItems="center">
        <Text dimColor>
          The Wizard finds an existing change, proposes the flag, and waits for
          your approval.
        </Text>
        <Text dimColor>It wires both experiences. You keep the rollout.</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          Setup usually takes about five minutes. New flags start at 0% rollout,
          so you decide when to release.
        </Text>
      </Box>
    </Box>
  );

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
