/**
 * ConfirmButton — the "physical" confirm button used to submit a selection.
 *
 * Pure render. Multi-select menus (PickerMenu mode="multi", GroupedPickerMenu)
 * append this below their options as the final focusable row: the user toggles
 * options with space/enter, then arrows down onto this button and presses enter
 * to submit. This replaces the older "enter anywhere submits" pattern, which
 * confused people who expected enter to toggle the focused item.
 *
 * Focus styling mirrors the option rows (accent + triangle when focused, muted
 * otherwise) but the single border marks it as a distinct, pressable target.
 */

import { Box, Text } from 'ink';
import { Icons, Colors } from '@ui/tui/styles';

interface ConfirmButtonProps {
  /** Button text. Defaults to "Confirm". */
  label?: string;
  /** Whether the cursor is currently on the button. */
  focused: boolean;
  /** Optional selected-item count, rendered as "Label (n)" when > 0. */
  count?: number;
}

export const ConfirmButton = ({
  label = 'Confirm',
  focused,
  count,
}: ConfirmButtonProps) => {
  const text = count && count > 0 ? `${label} (${count})` : label;
  return (
    <Box
      borderStyle="single"
      borderColor={focused ? Colors.accent : Colors.muted}
      paddingX={1}
    >
      <Text color={focused ? Colors.accent : Colors.muted} bold={focused}>
        {focused ? Icons.triangleSmallRight : ' '} {text}
      </Text>
    </Box>
  );
};
