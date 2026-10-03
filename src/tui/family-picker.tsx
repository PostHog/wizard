/**
 * An Ink picker over a family's subcommands: one headline, one option per
 * child, the first option focused. Resolves with the picked value once the
 * user selects; which children to show and what to run are the CLI's.
 */

import { Box, Text, render } from 'ink';
import { createElement } from 'react';

import { Colors } from '@tui/styles';
import { PickerMenu } from '@tui/primitives/PickerMenu';

export interface FamilyPickerOption<T> {
  label: string;
  value: T;
  hint?: string;
}

interface FamilyPickerAppProps<T> {
  parentLabel: string;
  options: FamilyPickerOption<T>[];
  onSelect: (value: T) => void;
}

function FamilyPickerApp<T>(props: FamilyPickerAppProps<T>) {
  return createElement(
    Box,
    { flexDirection: 'column', paddingX: 1, paddingY: 1 },
    createElement(
      Text,
      { bold: true, color: Colors.accent },
      props.parentLabel,
    ),
    createElement(Box, { height: 1 }),
    createElement(PickerMenu<T>, {
      message: 'Pick a subcommand',
      options: props.options,
      optionMarginBottom: 1,
      onSelect: (value) => {
        // PickerMenu in single mode returns one value; only the multi-mode
        // signature is the array variant. Narrow defensively.
        const picked = Array.isArray(value) ? value[0] : value;
        if (picked) props.onSelect(picked);
      },
    }),
  );
}

/** Render the picker and resolve with the selected option's value. */
export function renderFamilyPicker<T>(
  parentLabel: string,
  options: FamilyPickerOption<T>[],
): Promise<T> {
  return new Promise((resolve) => {
    let app: ReturnType<typeof render> | null = null;
    const handleSelect = (value: T): void => {
      app?.unmount();
      resolve(value);
    };
    app = render(
      createElement(FamilyPickerApp<T>, {
        parentLabel,
        options,
        onSelect: handleSelect,
      }),
    );
  });
}
