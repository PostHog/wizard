/**
 * KeyboardHintsBar — Row showing active keyboard shortcuts.
 *
 * Always reserves its row to prevent layout shift. When hints are
 * visible, renders them in dimmed grey text. When dismissed, renders
 * an empty reserved row.
 */

import { Box, Text } from 'ink';
import { useKeyboardHintsContext } from '@ui/tui/hooks/useKeyboardHints';
import { Colors } from '@ui/tui/styles';

export const KeyboardHintsBar = () => {
  const { hints, visible } = useKeyboardHintsContext();

  const showHints = visible && hints.length > 0;

  return (
    <Box height={1} paddingX={1}>
      {showHints &&
        hints.map((hint, i) => (
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
