/**
 * ConfirmButton — the confirm row used to submit a selection.
 *
 * Pure render. Multi-select menus (PickerMenu mode="multi", GroupedPickerMenu)
 * append this below their options as the final focusable row: the user toggles
 * options with enter, then arrows down onto this row and presses enter to
 * submit. This replaces the older "enter anywhere submits" pattern, which
 * confused people who expected enter to toggle the focused item.
 *
 * Renders flat, mirroring the option rows — a focus triangle and the label,
 * accent and bold when focused, dimmed otherwise — so it lines up under the
 * options instead of sitting in a separate boxed target.
 */

import { Text } from 'ink';
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
    <Text
      color={focused ? Colors.accent : undefined}
      bold={focused}
      dimColor={!focused}
    >
      {focused ? Icons.triangleSmallRight : ' '} {text}
    </Text>
  );
};
