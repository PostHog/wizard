import { Box, Text } from 'ink';
import { useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { IntroScreenLayout } from '@ui/tui/screens/IntroScreenLayout';
import {
  SkillSourceInfo,
  useSkillEntry,
} from '@ui/tui/screens/SkillSourceInfo';

interface ErrorTrackingIntroScreenProps {
  store: WizardStore;
}

export const ErrorTrackingIntroScreen = ({
  store,
}: ErrorTrackingIntroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [showingMoreInfo, setShowingMoreInfo] = useState(false);
  const { session } = store;
  // error-tracking resolves its skill variants per framework at run time, so
  // there's no single pre-seeded skillId. Fall back to the group id for the
  // "more info" lookup.
  const skillId = session.skillId ?? 'error-tracking';
  const { skillEntry, fetchFailed } = useSkillEntry(skillId, session.localMcp);

  const body = showingMoreInfo ? (
    <Box flexDirection="column" width={56}>
      <Box marginBottom={1}>
        <Text>
          The wizard is an agent that executes PostHog tasks. Its code is open
          source: <Text color="cyan">https://github.com/PostHog/wizard</Text>
        </Text>
      </Box>

      <Text>
        The{' '}
        <Text color="cyan" italic>
          error-tracking
        </Text>{' '}
        program makes uncaught errors reach PostHog with readable stack traces.
        It installs and initializes the PostHog SDK when the project doesn't
        have it yet, wires up exception capture through the SDK's own mechanism,
        and — on platforms that ship minified bundles or stripped binaries —
        sets up source-map / debug-symbol upload for your production builds.
      </Text>
      <Box marginTop={1}>
        <SkillSourceInfo
          skillId={skillId}
          skillEntry={skillEntry}
          fetchFailed={fetchFailed}
        />
      </Box>
    </Box>
  ) : (
    <Box flexDirection="column" alignItems="center">
      <Text>
        Let's make uncaught errors reach PostHog with readable stack traces.
      </Text>
    </Box>
  );

  const menuOptions = showingMoreInfo
    ? [{ label: 'Back', value: 'back' }]
    : [
        { label: 'Continue', value: 'continue' },
        { label: 'More info', value: 'more-info' },
        { label: 'Cancel', value: 'cancel' },
      ];

  const handleSelect = (value: string) => {
    if (value === 'cancel') process.exit(0);
    else if (value === 'more-info') setShowingMoreInfo(true);
    else if (value === 'back') setShowingMoreInfo(false);
    else store.completeSetup();
  };

  return (
    <IntroScreenLayout
      installDir={session.installDir}
      body={body}
      showDetection={!showingMoreInfo}
      programLabel={session.programLabel}
      skillId={session.skillId}
      menuOptions={menuOptions}
      onSelect={handleSelect}
    />
  );
};
