/**
 * PromptLabel — Compact inline label for input prompts.
 *
 * Renders: [!] message
 * where [!] is black text on accent background.
 */

import { Box, Text } from 'ink';
import { Colors } from '../styles.js';

interface PromptLabelProps {
  message: string;
}

export const PromptLabel = ({ message }: PromptLabelProps) => {
  return (
    <Box>
      <Text backgroundColor={Colors.accent} color="black" bold>
        {' \u2192 '}
      </Text>
      <Text bold color={Colors.accent}>
        {' '}
        {message}
      </Text>
    </Box>
  );
};
