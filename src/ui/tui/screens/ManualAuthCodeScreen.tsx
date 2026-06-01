/**
 * ManualAuthCodeScreen — Paste an OAuth authorization code by hand.
 *
 * Fallback for headless/remote shells where the browser can't reach the
 * wizard's local callback server. Shows the direct authorize URL (the localhost
 * one is unreachable from another machine), then the user pastes either the
 * full callback URL the browser was redirected to
 * (`http://localhost:8239/callback?code=...`) or just the code. On submit we
 * extract the code and resolve the in-flight OAuth flow; bad input shows inline
 * feedback without leaving the screen.
 *
 * Opened from AuthScreen via a keypress; Esc dismisses it.
 */

import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import { useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { Colors, Icons } from '@ui/tui/styles';
import { extractOAuthCode } from '@utils/oauth';

interface ManualAuthCodeScreenProps {
  store: WizardStore;
}

export const ManualAuthCodeScreen = ({ store }: ManualAuthCodeScreenProps) => {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const { session } = store;
  const [error, setError] = useState<string | null>(null);

  // Esc cancels and returns to the waiting auth screen.
  useInput((_input, key) => {
    if (key.escape) {
      store.dismissManualAuthCode();
    }
  });

  const handleSubmit = (value: string): void => {
    const code = extractOAuthCode(value);
    if (!code) {
      setError(
        "Couldn't find a code in that input. Paste the full callback URL or just the code.",
      );
      return;
    }
    store.submitManualAuthCode(code);
  };

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box marginBottom={1}>
        <Text bold color={Colors.accent}>
          {Icons.diamond} Paste authorization code
        </Text>
      </Box>

      {session.authorizeUrl && (
        <Box flexDirection="column" marginBottom={1}>
          <Text dimColor>
            On a remote/headless machine the local login link won't open. Open
            this URL in a browser on any machine to authorize:
          </Text>
          {/* No border + flexShrink={0}: Ink won't hard-wrap the URL, so it
              stays one continuous string the terminal soft-wraps — copies clean
              instead of being chopped across bordered, indented rows. */}
          <Box flexShrink={0} marginTop={1}>
            <Text color="cyan">{session.authorizeUrl}</Text>
          </Box>
        </Box>
      )}

      <Text>
        After authorizing, paste the callback URL it lands on — or just the code
        from it — here:
      </Text>
      <Box marginTop={1} width="100%">
        <TextInput
          placeholder="http://localhost:8239/callback?code=… or the code"
          onSubmit={handleSubmit}
        />
      </Box>

      {error && (
        <Box marginTop={1}>
          <Text color="yellow">{error}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text>
          <Text color={Colors.accent}>ENTER</Text>
          <Text dimColor> submit</Text>
          <Text dimColor> · </Text>
          <Text color={Colors.accent}>ESC</Text>
          <Text dimColor> cancel</Text>
        </Text>
      </Box>
    </Box>
  );
};
