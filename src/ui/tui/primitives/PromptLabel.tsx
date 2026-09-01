/**
 * PromptLabel — Compact inline label for input prompts.
 *
 * Renders: [!] message
 * where [!] is black text on accent background.
 */

import { Box, Text } from 'ink';
import { Colors } from '@ui/tui/styles';

interface PromptLabelProps {
  message?: string;
}

export const PromptLabel = ({ message }: PromptLabelProps) => {
  // No message → no row, so label-less pickers don't get a stray blank line.
  if (!message) return null;
  return (
    <Box>
      <Text bold color={Colors.accent}>
        {' '}
        {message}
      </Text>
    </Box>
  );
};
