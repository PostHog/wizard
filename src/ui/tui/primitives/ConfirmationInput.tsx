/**
 * ConfirmationInput — Continue/cancel with bordered prompt and button boxes.
 * Enter confirms, escape cancels.
 */

import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { Colors } from '../styles.js';

interface ConfirmationInputProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmationInput = ({
  message,
  onConfirm,
  onCancel,
}: ConfirmationInputProps) => {
  const [focused, setFocused] = useState<'continue' | 'cancel'>('continue');

  useInput((_input, key) => {
    if (key.leftArrow || key.rightArrow) {
      setFocused((f) => (f === 'continue' ? 'cancel' : 'continue'));
    }
    if (key.return) {
      if (focused === 'continue') {
        onConfirm();
      } else {
        onCancel();
      }
    }
    if (key.escape) {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column">
      <Box
        borderStyle="single"
        borderColor={Colors.accent}
        paddingX={1}
        alignSelf="flex-start"
      >
        <Text bold color={Colors.accent}>
          {message}
        </Text>
      </Box>
      <Box gap={1} marginTop={1} marginLeft={2}>
        <Box
          borderStyle="single"
          borderColor={focused === 'continue' ? Colors.accent : Colors.muted}
          paddingX={1}
        >
          <Text
            bold={focused === 'continue'}
            color={focused === 'continue' ? Colors.accent : Colors.muted}
          >
            Continue [Enter]
          </Text>
        </Box>
        <Box
          borderStyle="single"
          borderColor={focused === 'cancel' ? Colors.accent : Colors.muted}
          paddingX={1}
        >
          <Text
            bold={focused === 'cancel'}
            color={focused === 'cancel' ? Colors.accent : Colors.muted}
          >
            Cancel [Esc]
          </Text>
        </Box>
      </Box>
    </Box>
  );
};
