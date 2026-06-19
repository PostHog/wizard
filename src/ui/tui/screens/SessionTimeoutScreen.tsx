/**
 * SessionTimeoutScreen — shown when the OAuth login window expires before the
 * user completes authorization.
 *
 * Pushed as an overlay so it takes priority over the gated AuthScreen (which
 * never completes without credentials). Terminal state: any key exits, since
 * the only way forward is to re-run the wizard for a fresh login window.
 */

import { Box, Text, useInput } from 'ink';
import { useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { Colors } from '@ui/tui/styles';
import { OAUTH_TIMEOUT_MS } from '@lib/constants';

interface SessionTimeoutScreenProps {
  store: WizardStore;
}

const TIMEOUT_MINUTES = Math.round(OAUTH_TIMEOUT_MS / 60_000);

export const SessionTimeoutScreen = ({ store }: SessionTimeoutScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  useInput(() => {
    process.exit(1);
  });

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text color="red" bold>
        {'✘'} Login timed out
      </Text>

      <Box marginTop={1}>
        <Text>The OAuth link timed out after {TIMEOUT_MINUTES} minutes.</Text>
      </Box>

      <Box marginTop={1}>
        <Text>Re-run the wizard to get a fresh link and try again.</Text>
      </Box>

      <Box marginTop={1}>
        <Text color={Colors.muted}>Press any key to exit</Text>
      </Box>
    </Box>
  );
};
