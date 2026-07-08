/**
 * SelfDrivingHandoffScreen — the bridge between the integration run and the
 * Self-driving run. Shown only in the integrate path (PostHog wasn't present, so
 * the wizard set it up first); the already-has-PostHog path skips straight to
 * Self-driving with no note. Confirms the SDK is in, then hands off to the
 * Self-driving run.
 */

import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';

import type { WizardStore } from '@ui/tui/store';
import { PickerMenu } from '@ui/tui/primitives/index';
import { Colors } from '@ui/tui/styles';
import { SETUP_REPORT_FILE } from '@lib/programs/posthog-integration/index';
import { SELF_DRIVING_INTEGRATE_PATH_KEY } from '@lib/programs/self-driving/detect';

interface SelfDrivingHandoffScreenProps {
  store: WizardStore;
}

export const SelfDrivingHandoffScreen = ({
  store,
}: SelfDrivingHandoffScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  // The integration ran in the picked project (a monorepo sub-app, or the
  // root), so the report sits under that path.
  const rel = store.session.frameworkContext[SELF_DRIVING_INTEGRATE_PATH_KEY];
  const dir = typeof rel === 'string' && rel !== '.' ? `${rel}/` : '';
  const reportPath = `./${dir}${SETUP_REPORT_FILE}`;

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color={Colors.accent}>
        ✔ PostHog is installed
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Text>Now let&apos;s make your product self-driving.</Text>
        <Box marginTop={1}>
          <Text dimColor>
            Next, the agent connects GitHub, turns on signal sources, and tunes
            the scouts that watch your product data.
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>
            About 10 more minutes, and it needs your input a few times. Keep
            this terminal open.
          </Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <PickerMenu
          options={[{ label: 'Set up Self-driving [Enter]', value: 'go' }]}
          onSelect={() => store.confirmSelfDrivingHandoff()}
        />
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          You can find your PostHog integration report at{' '}
          <Text bold>{reportPath}</Text>
        </Text>
      </Box>
    </Box>
  );
};
