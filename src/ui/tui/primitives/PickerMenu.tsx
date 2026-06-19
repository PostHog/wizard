/**
 * PickerMenu — Single and multi select.
 * Single mode: custom renderer with small triangle indicator.
 * Multi mode: checkbox glyphs with space to toggle.
 *
 * Key bindings are declared via useKeyBindings, which auto-registers
 * hints in the KeyboardHintsBar.
 */

import { Box, Text } from 'ink';
import { useEffect, useState } from 'react';
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
  /**
   * Multi-select only: a secondary explanation rendered dimmed and wrapped on
   * its own line(s) beneath the label, for choices that need more than a title.
   * When unset, the row renders exactly as a label-only row.
   */
  description?: string;
  /** Glyph rendered before the label, in its own color — unaffected by
   *  focus and disabled styling. */
  icon?: { glyph: string; color?: string };
  /** Dimmed and unselectable; navigation skips over it. */
  disabled?: boolean;
  /**
   * Multi-select only: marks this option mutually exclusive with every other
   * option. Selecting it clears all other picks; selecting any non-exclusive
   * option clears it. Used e.g. for a browser connector that can't be
   * installed alongside local editors.
   */
  exclusive?: boolean;
}

/**
 * Step through a column's options in `dir`, wrapping, until an enabled
 * option is found. Returns `from` unchanged if the column is entirely
 * disabled.
 */
function stepEnabled<T>(
  options: PickerOption<T>[],
  rows: number,
  from: number,
  dir: 1 | -1,
): number {
  const col = Math.floor(from / rows);
  const colStart = col * rows;
  const colLen = Math.min(rows, options.length - colStart);
  let row = from % rows;
  for (let i = 0; i < colLen; i++) {
    row = (row + dir + colLen) % colLen;
    const idx = colStart + row;
    if (!options[idx]?.disabled) return idx;
  }
  return from;
}

/** Index of the first enabled option, for the initial focus. */
function firstEnabled<T>(options: PickerOption<T>[]): number {
  const idx = options.findIndex((o) => !o.disabled);
  return idx === -1 ? 0 : idx;
}

interface PickerMenuProps<T> {
  message?: string;
  options: PickerOption<T>[];
  mode?: 'single' | 'multi';
  centered?: boolean;
  columns?: 1 | 2 | 3 | 4;
  /**
   * Vertical space between options, in TUI rows. Defaults to 0 — i.e.
   * options stack tightly. Set to 1+ when the option labels are long
   * (wrap across multiple lines) or for visual breathing room.
   */
  optionMarginBottom?: number;
  onSelect: (value: T | T[]) => void;
}

export const PickerMenu = <T,>({
  message,
  options,
  mode = 'single',
  centered = false,
  columns = 1,
  optionMarginBottom = 0,
  onSelect,
}: PickerMenuProps<T>) => {
  if (mode === 'multi') {
    return (
      <MultiPickerMenu
        message={message}
        options={options}
        centered={centered}
        columns={columns}
        optionMarginBottom={optionMarginBottom}
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
      optionMarginBottom={optionMarginBottom}
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
  optionMarginBottom = 0,
  onSelect,
}: {
  message?: string;
  options: PickerOption<T>[];
  centered?: boolean;
  columns?: number;
  optionMarginBottom?: number;
  onSelect: (value: T | T[]) => void;
}) => {
  const [focused, setFocused] = useState(() => firstEnabled(options));
  const rows = Math.ceil(options.length / columns);

  // Re-validate focus when the options change while mounted \u2014 a list
  // that shrinks or disables entries can leave `focused` pointing at a
  // missing or disabled option, which would make enter a no-op.
  useEffect(() => {
    if (focused >= options.length || options[focused]?.disabled) {
      setFocused(firstEnabled(options));
    }
  }, [options, focused]);

  const bindings: KeyBinding[] = [
    {
      match: [KeyMatch.UpArrow, KeyMatch.DownArrow],
      label: '\u2191\u2193',
      action: 'navigate',
      handler: (_input, key) => {
        if (key.upArrow) {
          setFocused(stepEnabled(options, rows, focused, -1));
        }
        if (key.downArrow) {
          setFocused(stepEnabled(options, rows, focused, 1));
        }
      },
    },
    {
      match: KeyMatch.Return,
      label: 'enter',
      action: 'select',
      handler: () => {
        const selected = options[focused];
        if (selected && !selected.disabled) {
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

        let next = focused;
        if (key.leftArrow) {
          const prevCol = col > 0 ? col - 1 : columns - 1;
          next = Math.min(prevCol * rows + row, options.length - 1);
        }
        if (key.rightArrow) {
          const nextCol = col < columns - 1 ? col + 1 : 0;
          next = Math.min(nextCol * rows + row, options.length - 1);
        }
        // Landing on a disabled option slides to the column's nearest
        // enabled one.
        if (options[next]?.disabled) {
          next = stepEnabled(options, rows, next, 1);
        }
        setFocused(next);
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
                <Box key={flatIdx} gap={1} marginBottom={optionMarginBottom}>
                  <Text
                    color={isFocused ? Colors.accent : undefined}
                    dimColor={!isFocused}
                  >
                    {isFocused ? Icons.triangleSmallRight : ' '}
                  </Text>
                  {opt.icon && (
                    <Text color={opt.icon.color}>{opt.icon.glyph}</Text>
                  )}
                  <Text
                    color={
                      opt.disabled
                        ? Colors.muted
                        : isFocused
                        ? Colors.accent
                        : undefined
                    }
                    bold={isFocused && !opt.disabled}
                    dimColor={!isFocused || opt.disabled}
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
  optionMarginBottom = 0,
  onSelect,
}: {
  message?: string;
  options: PickerOption<T>[];
  centered?: boolean;
  columns?: number;
  optionMarginBottom?: number;
  onSelect: (value: T | T[]) => void;
}) => {
  const [focused, setFocused] = useState(() => firstEnabled(options));
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const rows = Math.ceil(options.length / columns);

  // Re-validate focus when the options change while mounted — a list
  // that shrinks or disables entries can leave `focused` pointing at a
  // missing or disabled option, which would make enter a no-op.
  useEffect(() => {
    if (focused >= options.length || options[focused]?.disabled) {
      setFocused(firstEnabled(options));
    }
  }, [options, focused]);

  const bindings: KeyBinding[] = [
    {
      match: [KeyMatch.UpArrow, KeyMatch.DownArrow],
      label: '\u2191\u2193',
      action: 'navigate',
      handler: (_input, key) => {
        if (key.upArrow) {
          setFocused(stepEnabled(options, rows, focused, -1));
        }
        if (key.downArrow) {
          setFocused(stepEnabled(options, rows, focused, 1));
        }
      },
    },
    {
      match: KeyMatch.Space,
      label: 'space',
      action: 'toggle',
      handler: () => {
        if (options[focused]?.disabled) return;
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(focused)) {
            next.delete(focused);
            return next;
          }
          // Enforce mutual exclusivity: an exclusive option clears every other
          // pick; any other option clears previously-picked exclusive ones.
          if (options[focused]?.exclusive) {
            return new Set([focused]);
          }
          for (const i of next) {
            if (options[i]?.exclusive) {
              next.delete(i);
            }
          }
          next.add(focused);
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
          if (hovered && !hovered.disabled) {
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

        let next = focused;
        if (key.leftArrow) {
          const prevCol = col > 0 ? col - 1 : columns - 1;
          next = Math.min(prevCol * rows + row, options.length - 1);
        }
        if (key.rightArrow) {
          const nextCol = col < columns - 1 ? col + 1 : 0;
          next = Math.min(nextCol * rows + row, options.length - 1);
        }
        // Landing on a disabled option slides to the column's nearest
        // enabled one.
        if (options[next]?.disabled) {
          next = stepEnabled(options, rows, next, 1);
        }
        setFocused(next);
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
                <Box
                  key={flatIdx}
                  flexDirection="column"
                  marginBottom={optionMarginBottom}
                >
                  <Box gap={1}>
                    <Text
                      color={isSelected ? 'white' : Colors.muted}
                      dimColor={!isFocused && !isSelected}
                    >
                      {checkbox}
                    </Text>
                    {opt.icon && (
                      <Text color={opt.icon.color}>{opt.icon.glyph}</Text>
                    )}
                    <Text
                      color={
                        opt.disabled
                          ? Colors.muted
                          : isFocused
                          ? Colors.accent
                          : undefined
                      }
                      bold={isFocused && !opt.disabled}
                      dimColor={!isFocused || opt.disabled}
                    >
                      {label}
                    </Text>
                  </Box>
                  {/* Optional dimmed, wrapped explanation under the label. The
                      explicit width forces Ink to wrap (an unconstrained Box
                      shrinks to its content and never wraps). Renders only when
                      set, so label-only rows are byte-for-byte unchanged. */}
                  {opt.description && (
                    <Box marginLeft={4} width={56}>
                      <Text dimColor wrap="wrap">
                        {opt.description}
                      </Text>
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>
        ))}
      </Box>
    </Box>
  );
};
