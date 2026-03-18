/**
 * AuthErrorScreen — Shown when the Anthropic API returns a 401.
 *
 * Claude Code's own auth can conflict with the wizard's OAuth token.
 * This overlay tells the user to log out of Claude Code and retry.
 */

import { Box, Text, useInput } from 'ink';
import { Colors } from '../styles.js';

export const AuthErrorScreen = () => {
  useInput(() => {
    process.exit(1);
  });

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text color="red" bold>
        {'\u2718'} Authentication error
      </Text>

      <Box flexDirection="column" marginTop={1}>
        <Text>
          The Wizard couldn't connect to the PostHog LLM Gateway. If
          you use Claude Code, its credentials might conflict with the
          Wizard.
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          Try logging out of Claude Code temporarily and re-running the Wizard
          by running:
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1} paddingLeft={2}>
        <Text color="cyan">claude auth logout</Text>
      </Box>

      <Box marginTop={1}>
        <Text color={Colors.muted}>Press any key to exit</Text>
      </Box>
    </Box>
  );
};
