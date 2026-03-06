/**
 * PickerMenu — Single and multi select.
 * Single mode: custom renderer with small triangle indicator.
 * Multi mode: checkbox glyphs with space to toggle.
 */

import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { Icons, Colors } from '../styles.js';
import { PromptLabel } from './PromptLabel.js';

interface PickerOption<T> {
  label: string;
  value: T;
  hint?: string;
}

interface PickerMenuProps<T> {
  message: string;
  options: PickerOption<T>[];
  mode?: 'single' | 'multi';
  centered?: boolean;
  onSelect: (value: T | T[]) => void;
}

export const PickerMenu = <T,>({
  message,
  options,
  mode = 'single',
  centered = false,
  onSelect,
}: PickerMenuProps<T>) => {
  if (mode === 'multi') {
    return (
      <MultiPickerMenu
        message={message}
        options={options}
        centered={centered}
        onSelect={onSelect}
      />
    );
  }

  return (
    <SinglePickerMenu
      message={message}
      options={options}
      centered={centered}
      onSelect={onSelect}
    />
  );
};

/** Custom single-select with triangle indicator and accent highlight. */
const SinglePickerMenu = <T,>({
  message,
  options,
  centered = false,
  onSelect,
}: {
  message: string;
  options: PickerOption<T>[];
  centered?: boolean;
  onSelect: (value: T | T[]) => void;
}) => {
  const [focused, setFocused] = useState(0);

  useInput((_input, key) => {
    if (key.upArrow) {
      setFocused((i) => (i > 0 ? i - 1 : options.length - 1));
    }
    if (key.downArrow) {
      setFocused((i) => (i < options.length - 1 ? i + 1 : 0));
    }
    if (key.return) {
      const selected = options[focused];
      if (selected) {
        onSelect(selected.value);
      }
    }
  });

  const align = centered ? 'center' : undefined;

  return (
    <Box flexDirection="column" alignItems={align}>
      <PromptLabel message={message} />
      <Box flexDirection="column" marginLeft={centered ? 0 : 2} marginTop={1}>
        {options.map((opt, i) => {
          const isFocused = i === focused;
          const label = opt.hint ? `${opt.label} (${opt.hint})` : opt.label;
          return (
            <Box key={i} gap={1}>
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
    </Box>
  );
};

/** Custom multi-select with checkbox glyphs and accent highlight. */
const MultiPickerMenu = <T,>({
  message,
  options,
  centered = false,
  onSelect,
}: {
  message: string;
  options: PickerOption<T>[];
  centered?: boolean;
  onSelect: (value: T | T[]) => void;
}) => {
  const [focused, setFocused] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useInput((_input, key) => {
    if (key.upArrow) {
      setFocused((i) => (i > 0 ? i - 1 : options.length - 1));
    }
    if (key.downArrow) {
      setFocused((i) => (i < options.length - 1 ? i + 1 : 0));
    }
    if (_input === ' ') {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(focused)) {
          next.delete(focused);
        } else {
          next.add(focused);
        }
        return next;
      });
    }
    if (key.return) {
      const values = [...selected].sort().map((i) => options[i].value);
      onSelect(values);
    }
  });

  return (
    <Box flexDirection="column" alignItems={centered ? 'center' : undefined}>
      <PromptLabel message={message} />
      <Text dimColor> (space to toggle, enter to submit)</Text>
      <Box flexDirection="column" marginLeft={centered ? 0 : 2} marginTop={1}>
        {options.map((opt, i) => {
          const isFocused = i === focused;
          const isSelected = selected.has(i);
          const label = opt.hint ? `${opt.label} (${opt.hint})` : opt.label;
          const checkbox = isSelected ? Icons.squareFilled : Icons.squareOpen;
          return (
            <Box key={i} gap={1}>
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
    </Box>
  );
};
