/**
 * ManualAuthCodeScreen — Overlay for pasting an OAuth authorization code by hand.
 *
 * Fallback for headless/remote shells where the browser can't reach the
 * wizard's local callback server. The user pastes either the full callback
 * URL the browser was redirected to (`http://localhost:8239/callback?code=...`)
 * or just the code. On submit we extract the code and resolve the in-flight
 * OAuth flow; bad input shows inline feedback without closing the modal.
 *
 * Opened from AuthScreen via a keypress; Esc dismisses it.
 */

import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import { useState, useSyncExternalStore } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { ModalOverlay } from '@ui/tui/primitives/index';
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
    <ModalOverlay
      borderColor={Colors.accent}
      title={`${Icons.diamond} Paste authorization code`}
      titleColor={Colors.accent}
      width={72}
      feedback={error}
      footer={
        <Box width="100%" justifyContent="flex-end">
          <Text>
            <Text color={Colors.accent}>ENTER</Text>
            <Text dimColor> submit</Text>
            <Text dimColor> · </Text>
            <Text color={Colors.accent}>ESC</Text>
            <Text dimColor> cancel</Text>
          </Text>
        </Box>
      }
    >
      <Box flexDirection="column">
        <Text>
          If the browser couldn't redirect back (e.g. on a remote or headless
          machine), paste the callback URL it landed on — or just the code from
          it — here.
        </Text>
        <Box marginTop={1} width="100%">
          <TextInput
            placeholder="http://localhost:8239/callback?code=… or the code"
            onSubmit={handleSubmit}
          />
        </Box>
      </Box>
    </ModalOverlay>
  );
};
