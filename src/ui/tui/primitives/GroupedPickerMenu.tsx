/**
 * GroupedPickerMenu — Multi-select with category headers.
 *
 * Renders groups of options with bold category labels.
 * Arrow keys navigate selectable items (headers are skipped),
 * space toggles, "a" toggles all, enter submits.
 */

import { Box, Text, useInput } from 'ink';
import { useState, useMemo } from 'react';
import { Icons, Colors } from '../styles.js';
import { PromptLabel } from './PromptLabel.js';

type DetailPart = {
  text: string;
  bold?: boolean;
  color?: 'success';
};

type DetailLine = {
  text?: string;
  bold?: boolean;
  parts?: DetailPart[];
};

interface GroupOption {
  value: string;
  label: string;
  hint?: string;
  details?: DetailLine[];
}

interface GroupedPickerMenuProps {
  message?: string;
  groups: Record<string, GroupOption[]>;
  initialSelected?: string[];
  onSelect: (values: string[]) => void;
}

type Row =
  | { kind: 'header'; label: string }
  | {
      kind: 'option';
      value: string;
      label: string;
      hint?: string;
      details?: DetailLine[];
    };

export const GroupedPickerMenu = ({
  message,
  groups,
  initialSelected,
  onSelect,
}: GroupedPickerMenuProps) => {
  // Build a flat row list with headers interleaved
  const rows = useMemo<Row[]>(() => {
    const result: Row[] = [];
    for (const [groupName, options] of Object.entries(groups)) {
      result.push({ kind: 'header', label: groupName });
      for (const opt of options) {
        result.push({ kind: 'option', ...opt });
      }
    }
    return result;
  }, [groups]);

  // Indices of selectable (non-header) rows
  const selectableIndices = useMemo(
    () =>
      rows.map((r, i) => (r.kind === 'option' ? i : -1)).filter((i) => i >= 0),
    [rows],
  );

  // All option values for toggle-all
  const allValues = useMemo(
    () =>
      rows
        .filter((r): r is Row & { kind: 'option' } => r.kind === 'option')
        .map((r) => r.value),
    [rows],
  );

  const [focusedSelectable, setFocusedSelectable] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialSelected ?? allValues),
  );

  const focusedRowIdx = selectableIndices[focusedSelectable] ?? 0;

  useInput((input, key) => {
    if (key.upArrow) {
      setFocusedSelectable((prev) =>
        prev > 0 ? prev - 1 : selectableIndices.length - 1,
      );
    }
    if (key.downArrow) {
      setFocusedSelectable((prev) =>
        prev < selectableIndices.length - 1 ? prev + 1 : 0,
      );
    }
    if (input === ' ') {
      const row = rows[focusedRowIdx];
      if (row?.kind === 'option') {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(row.value)) {
            next.delete(row.value);
          } else {
            next.add(row.value);
          }
          return next;
        });
      }
    }
    if (input === 'a') {
      setSelected((prev) => {
        if (prev.size === allValues.length) {
          return new Set();
        }
        return new Set(allValues);
      });
    }
    if (key.return) {
      onSelect([...selected]);
    }
  });

  return (
    <Box flexDirection="column">
      <PromptLabel message={message} />
      <Text dimColor>
        {' '}
        (space to toggle, a to toggle all, enter to confirm)
      </Text>
      <Box flexDirection="column" marginTop={1} marginLeft={2}>
        {rows.map((row, idx) => {
          if (row.kind === 'header') {
            return (
              <Box key={`h-${idx}`} marginTop={idx > 0 ? 1 : 0}>
                <Text bold dimColor>
                  {row.label}
                </Text>
              </Box>
            );
          }

          const isFocused = focusedRowIdx === idx;
          const isSelected = selected.has(row.value);
          const checkbox = isSelected ? Icons.squareFilled : Icons.squareOpen;
          const label = row.hint ? `${row.label} (${row.hint})` : row.label;
          const detailDimColor = !isFocused && !isSelected;

          return (
            <Box key={row.value} flexDirection="column" marginLeft={1}>
              <Box gap={1}>
                <Text
                  color={isSelected ? 'white' : Colors.muted}
                  dimColor={detailDimColor}
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
              {row.details?.map((detail) => (
                <Box
                  key={`${row.value}-${
                    detail.text ??
                    detail.parts?.map((part) => part.text).join('')
                  }`}
                  marginLeft={4}
                >
                  <Text>
                    {detail.parts ? (
                      detail.parts.map((part, index) => (
                        <Text
                          key={`${row.value}-${index}-${part.text}`}
                          color={
                            part.color === 'success'
                              ? Colors.success
                              : undefined
                          }
                          dimColor={detailDimColor}
                          bold={part.bold}
                        >
                          {part.text}
                        </Text>
                      ))
                    ) : (
                      <Text dimColor={detailDimColor} bold={detail.bold}>
                        {detail.text}
                      </Text>
                    )}
                  </Text>
                </Box>
              ))}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};
