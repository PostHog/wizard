/**
 * PickerMenu — Single and multi select.
 * Single mode: custom renderer with small triangle indicator.
 * Multi mode: checkbox glyphs with space to toggle.
 *
 * Key bindings are declared via useKeyBindings, which auto-registers
 * hints in the KeyboardHintsBar.
 */

import { Box, Text } from 'ink';
import { useState } from 'react';
import { Icons, Colors } from '@ui/tui/styles';
import { PromptLabel } from './PromptLabel.js';
import {
  useKeyBindings,
  KeyMatch,
  type KeyBinding,
} from '@ui/tui/hooks/useKeyBindings';

interface PickerOption<T> {
  label: string;
  value: T;
  hint?: string;
}

interface PickerMenuProps<T> {
  message?: string;
  options: PickerOption<T>[];
  mode?: 'single' | 'multi';
  centered?: boolean;
  columns?: 1 | 2 | 3 | 4;
  onSelect: (value: T | T[]) => void;
}

export const PickerMenu = <T,>({
  message,
  options,
  mode = 'single',
  centered = false,
  columns = 1,
  onSelect,
}: PickerMenuProps<T>) => {
  if (mode === 'multi') {
    return (
      <MultiPickerMenu
        message={message}
        options={options}
        centered={centered}
        columns={columns}
        onSelect={onSelect}
      />
    );
  }

  return (
    <SinglePickerMenu
      message={message}
      options={options}
      centered={centered}
      columns={columns}
      onSelect={onSelect}
    />
  );
};

/** Custom single-select with triangle indicator and accent highlight. */
const SinglePickerMenu = <T,>({
  message,
  options,
  centered = false,
  columns = 1,
  onSelect,
}: {
  message?: string;
  options: PickerOption<T>[];
  centered?: boolean;
  columns?: number;
  onSelect: (value: T | T[]) => void;
}) => {
  const [focused, setFocused] = useState(0);
  const rows = Math.ceil(options.length / columns);

  const bindings: KeyBinding[] = [
    {
      match: [KeyMatch.UpArrow, KeyMatch.DownArrow],
      label: '\u2191\u2193',
      action: 'navigate',
      handler: (_input, key) => {
        const col = Math.floor(focused / rows);
        const row = focused % rows;

        if (key.upArrow) {
          if (row > 0) {
            setFocused(col * rows + row - 1);
          } else {
            setFocused(Math.min(col * rows + rows - 1, options.length - 1));
          }
        }
        if (key.downArrow) {
          const next = col * rows + row + 1;
          if (next < options.length && row + 1 < rows) {
            setFocused(next);
          } else {
            setFocused(col * rows);
          }
        }
      },
    },
    {
      match: KeyMatch.Return,
      label: 'enter',
      action: 'select',
      handler: () => {
        const selected = options[focused];
        if (selected) {
          onSelect(selected.value);
        }
      },
    },
  ];

  if (columns > 1) {
    bindings.splice(1, 0, {
      match: [KeyMatch.LeftArrow, KeyMatch.RightArrow],
      label: '\u2190\u2192',
      action: 'navigate',
      handler: (_input, key) => {
        const col = Math.floor(focused / rows);
        const row = focused % rows;

        if (key.leftArrow) {
          const prevCol = col > 0 ? col - 1 : columns - 1;
          setFocused(Math.min(prevCol * rows + row, options.length - 1));
        }
        if (key.rightArrow) {
          const nextCol = col < columns - 1 ? col + 1 : 0;
          setFocused(Math.min(nextCol * rows + row, options.length - 1));
        }
      },
    });
  }

  useKeyBindings('single-picker', bindings);

  // Chunk options into columns (column-first ordering)
  const columnArrays: PickerOption<T>[][] = [];
  for (let c = 0; c < columns; c++) {
    columnArrays.push(options.slice(c * rows, c * rows + rows));
  }

  const align = centered ? 'center' : undefined;

  return (
    <Box flexDirection="column" alignItems={align}>
      <PromptLabel message={message} />
      <Box flexDirection="row" gap={4}>
        {columnArrays.map((colOpts, colIdx) => (
          <Box key={colIdx} flexDirection="column">
            {colOpts.map((opt, rowIdx) => {
              const flatIdx = colIdx * rows + rowIdx;
              const isFocused = flatIdx === focused;
              const label = opt.hint ? `${opt.label} (${opt.hint})` : opt.label;
              return (
                <Box key={flatIdx} gap={1}>
                  <Text
                    color={isFocused ? Colors.accent : undefined}
                    dimColor={!isFocused}
                  >
                    {isFocused ? Icons.triangleSmallRight : ' '}
                  </Text>
                  <Text
                    color={isFocused ? Colors.accent : undefined}
                    bold={isFocused}
                    dimColor={!isFocused}
                  >
                    {label}
                  </Text>
                </Box>
              );
            })}
          </Box>
        ))}
      </Box>
    </Box>
  );
};

/** Custom multi-select with checkbox glyphs and accent highlight. */
const MultiPickerMenu = <T,>({
  message,
  options,
  centered = false,
  columns = 1,
  onSelect,
}: {
  message?: string;
  options: PickerOption<T>[];
  centered?: boolean;
  columns?: number;
  onSelect: (value: T | T[]) => void;
}) => {
  const [focused, setFocused] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const rows = Math.ceil(options.length / columns);

  const bindings: KeyBinding[] = [
    {
      match: [KeyMatch.UpArrow, KeyMatch.DownArrow],
      label: '\u2191\u2193',
      action: 'navigate',
      handler: (_input, key) => {
        const col = Math.floor(focused / rows);
        const row = focused % rows;

        if (key.upArrow) {
          if (row > 0) {
            setFocused(col * rows + row - 1);
          } else {
            setFocused(Math.min(col * rows + rows - 1, options.length - 1));
          }
        }
        if (key.downArrow) {
          const next = col * rows + row + 1;
          if (next < options.length && row + 1 < rows) {
            setFocused(next);
          } else {
            setFocused(col * rows);
          }
        }
      },
    },
    {
      match: KeyMatch.Space,
      label: 'space',
      action: 'toggle',
      handler: () => {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(focused)) {
            next.delete(focused);
          } else {
            next.add(focused);
          }
          return next;
        });
      },
    },
    {
      match: KeyMatch.Return,
      label: 'enter',
      action: 'confirm',
      handler: () => {
        if (selected.size === 0) {
          const hovered = options[focused];
          if (hovered) {
            onSelect(hovered.value);
          }
        } else {
          const values = [...selected].sort().map((i) => options[i].value);
          onSelect(values);
        }
      },
    },
  ];

  if (columns > 1) {
    bindings.splice(1, 0, {
      match: [KeyMatch.LeftArrow, KeyMatch.RightArrow],
      label: '\u2190\u2192',
      action: 'navigate',
      handler: (_input, key) => {
        const col = Math.floor(focused / rows);
        const row = focused % rows;

        if (key.leftArrow) {
          const prevCol = col > 0 ? col - 1 : columns - 1;
          setFocused(Math.min(prevCol * rows + row, options.length - 1));
        }
        if (key.rightArrow) {
          const nextCol = col < columns - 1 ? col + 1 : 0;
          setFocused(Math.min(nextCol * rows + row, options.length - 1));
        }
      },
    });
  }

  useKeyBindings('multi-picker', bindings);

  const columnArrays: PickerOption<T>[][] = [];
  for (let c = 0; c < columns; c++) {
    columnArrays.push(options.slice(c * rows, c * rows + rows));
  }

  return (
    <Box flexDirection="column" alignItems={centered ? 'center' : undefined}>
      <PromptLabel message={message} />
      <Box
        flexDirection="row"
        gap={4}
        marginLeft={centered ? 0 : 2}
        marginTop={1}
      >
        {columnArrays.map((colOpts, colIdx) => (
          <Box key={colIdx} flexDirection="column">
            {colOpts.map((opt, rowIdx) => {
              const flatIdx = colIdx * rows + rowIdx;
              const isFocused = flatIdx === focused;
              const isSelected = selected.has(flatIdx);
              const label = opt.hint ? `${opt.label} (${opt.hint})` : opt.label;
              const checkbox = isSelected
                ? Icons.squareFilled
                : Icons.squareOpen;
              return (
                <Box key={flatIdx} gap={1}>
                  <Text
                    color={isSelected ? 'white' : Colors.muted}
                    dimColor={!isFocused && !isSelected}
                  >
                    {checkbox}
                  </Text>
                  <Text
                    color={isFocused ? Colors.accent : undefined}
                    bold={isFocused}
                    dimColor={!isFocused}
                  >
                    {label}
                  </Text>
                </Box>
              );
            })}
          </Box>
        ))}
      </Box>
    </Box>
  );
};
