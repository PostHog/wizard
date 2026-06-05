/**
 * KeyboardHintsBar — Row showing active keyboard shortcuts.
 *
 * Always reserves its row to prevent layout shift, and always renders the
 * active hints (in dimmed grey text) while a screen has registered them.
 */

import { Box, Text } from 'ink';
import { useKeyboardHintsContext } from '@ui/tui/hooks/useKeyboardHints';
import { Colors } from '@ui/tui/styles';

export const KeyboardHintsBar = () => {
  const { hints } = useKeyboardHintsContext();

  return (
    <Box height={1} paddingX={1}>
      {hints.map((hint, i) => (
        <Box
          key={`${hint.label}-${hint.action}`}
          marginRight={i < hints.length - 1 ? 2 : 0}
        >
          <Text bold color={Colors.muted}>
            {hint.label}
          </Text>
          <Text dimColor> {hint.action}</Text>
        </Box>
      ))}
    </Box>
  );
};
