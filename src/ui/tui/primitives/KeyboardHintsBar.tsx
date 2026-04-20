/**
 * KeyboardHintsBar — Bottom-row bar showing active keyboard shortcuts.
 *
 * Reads hints from KeyboardHintsContext. Each hint rendered as:
 *   <bold key> <action>
 * Separated by spaces. Auto-hides when the context signals dismissal.
 */

import { Box, Text } from 'ink';
import { useKeyboardHintsContext } from '../hooks/useKeyboardHints.js';

export const KeyboardHintsBar = () => {
  const { hints, visible } = useKeyboardHintsContext();

  if (!visible || hints.length === 0) {
    return null;
  }

  return (
    <Box height={1} paddingX={1}>
      {hints.map((hint, i) => (
        <Box
          key={`${hint.label}-${hint.action}`}
          marginRight={i < hints.length - 1 ? 2 : 0}
        >
          <Text bold dimColor>
            {hint.label}
          </Text>
          <Text dimColor> {hint.action}</Text>
        </Box>
      ))}
    </Box>
  );
};
