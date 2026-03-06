/**
 * ConfirmationInput — Continue/cancel prompt.
 * Enter confirms, escape cancels. Arrow keys toggle focus.
 */

import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { Icons, Colors } from '../styles.js';
import { PromptLabel } from './PromptLabel.js';

interface ConfirmationInputProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
}

enum FocusTarget {
  Continue = 'continue',
  Cancel = 'cancel',
}

export const ConfirmationInput = ({
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'Continue [Enter]',
  cancelLabel = 'Cancel [Esc]',
}: ConfirmationInputProps) => {
  const [focused, setFocused] = useState<FocusTarget>(FocusTarget.Continue);

  useInput((_input, key) => {
    if (key.leftArrow || key.rightArrow) {
      setFocused((f) =>
        f === FocusTarget.Continue ? FocusTarget.Cancel : FocusTarget.Continue,
      );
    }
    if (key.return) {
      if (focused === FocusTarget.Continue) {
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
      <PromptLabel message={message} />
      <Box gap={2} marginTop={1} marginLeft={2}>
        <Text
          bold={focused === FocusTarget.Continue}
          color={
            focused === FocusTarget.Continue ? Colors.accent : Colors.muted
          }
        >
          {focused === FocusTarget.Continue ? Icons.triangleSmallRight : ' '}{' '}
          {confirmLabel}
        </Text>
        <Text
          bold={focused === FocusTarget.Cancel}
          color={focused === FocusTarget.Cancel ? Colors.accent : Colors.muted}
        >
          {focused === FocusTarget.Cancel ? Icons.triangleSmallRight : ' '}{' '}
          {cancelLabel}
        </Text>
      </Box>
    </Box>
  );
};
