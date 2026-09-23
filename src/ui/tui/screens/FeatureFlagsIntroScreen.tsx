import { Box, Text } from 'ink';
import { useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { IntroScreenLayout } from '@ui/tui/screens/IntroScreenLayout';
import {
  SkillSourceInfo,
  useSkillEntry,
} from '@ui/tui/screens/SkillSourceInfo';

interface FeatureFlagsIntroScreenProps {
  store: WizardStore;
}

const FEATURE_FLAGS_STEP_SKILL_ID = 'integration-v2-feature-flags-step';

export const FeatureFlagsIntroScreen = ({
  store,
}: FeatureFlagsIntroScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const [showingMoreInfo, setShowingMoreInfo] = useState(false);
  const { session } = store;
  const { skillEntry, fetchFailed } = useSkillEntry(
    FEATURE_FLAGS_STEP_SKILL_ID,
  );

  const body = showingMoreInfo ? (
    <Box flexDirection="column" width={56}>
      <Box marginBottom={1}>
        <Text>
          The Wizard is an agent, it's here to help you set up PostHog. Its code
          is open source:{' '}
          <Text color="cyan">https://github.com/PostHog/wizard</Text>
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text>
          Feature flags let you ship code turned off, roll it out to a
          percentage of users or a chosen group, and switch it off in seconds
          without a deploy. The same flags run your experiments.
        </Text>
      </Box>

      <Text>
        The{' '}
        <Text color="cyan" italic>
          feature-flags
        </Text>{' '}
        program creates example flags in PostHog, off at 0% rollout: one for
        your backend and one for your frontend, for each side your app has. It
        installs and initializes the PostHog SDKs if needed, evaluates each flag
        once in your code, and writes a report on how to turn them on.
      </Text>
      <Box marginTop={1}>
        <SkillSourceInfo
          skillId={FEATURE_FLAGS_STEP_SKILL_ID}
          skillEntry={skillEntry}
          fetchFailed={fetchFailed}
        />
      </Box>
    </Box>
  ) : (
    <Box flexDirection="column" alignItems="center">
      <Text>
        Let's add your first PostHog feature flags, so you can ship code and
        turn it on when you're ready.
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

  const menuActions: Record<string, () => void> = {
    cancel: () => process.exit(0),
    'more-info': () => setShowingMoreInfo(true),
    back: () => setShowingMoreInfo(false),
    continue: () => store.completeSetup(),
  };

  return (
    <IntroScreenLayout
      installDir={session.installDir}
      body={body}
      showDetection={!showingMoreInfo}
      programLabel={session.programLabel}
      skillId={session.skillId}
      menuOptions={menuOptions}
      onSelect={(value: string) => menuActions[value]?.()}
    />
  );
};
