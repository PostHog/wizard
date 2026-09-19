/**
 * ConfirmationInput — Continue/cancel prompt.
 * Enter confirms, escape cancels. Arrow keys toggle focus.
 *
 * Key bindings are declared via useKeyBindings, which auto-registers
 * hints in the KeyboardHintsBar.
 */

import { Box, Text } from 'ink';
import { useState } from 'react';
import { Icons, Colors } from '../styles.js';
import { PromptLabel } from './PromptLabel.js';
import { useKeyBindings, KeyMatch } from '../hooks/useKeyBindings.js';

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
  confirmLabel = 'Continue',
  cancelLabel = 'Cancel',
}: ConfirmationInputProps) => {
  const [focused, setFocused] = useState<FocusTarget>(FocusTarget.Continue);

  useKeyBindings('confirmation', [
    {
      match: [KeyMatch.LeftArrow, KeyMatch.RightArrow],
      label: '\u2190\u2192',
      action: 'switch',
      handler: () => {
        setFocused((f) =>
          f === FocusTarget.Continue
            ? FocusTarget.Cancel
            : FocusTarget.Continue,
        );
      },
    },
    {
      match: KeyMatch.Return,
      label: 'enter',
      action: 'confirm',
      handler: () => {
        if (focused === FocusTarget.Continue) {
          onConfirm();
        } else {
          onCancel();
        }
      },
    },
    {
      match: KeyMatch.Escape,
      label: 'esc',
      action: 'cancel',
      handler: () => {
        onCancel();
      },
    },
  ]);

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
