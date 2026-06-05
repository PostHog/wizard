/**
 * GroupedPickerMenu — Multi-select with category headers.
 *
 * Renders groups of options with bold category labels.
 * Arrow keys navigate selectable items (headers are skipped),
 * space toggles, "a" toggles all, enter submits.
 *
 * When content exceeds available terminal height, the list scrolls
 * to keep the focused item visible with up/down indicators.
 *
 * Key bindings are declared via useKeyBindings, which auto-registers
 * hints in the KeyboardHintsBar.
 */

import { Box, Text } from 'ink';
import { useState, useMemo } from 'react';
import { Icons, Colors } from '@ui/tui/styles';
import { PromptLabel } from './PromptLabel.js';
import { useStdoutDimensions } from '@ui/tui/hooks/useStdoutDimensions';
import { useKeyBindings, KeyMatch } from '@ui/tui/hooks/useKeyBindings';

interface GroupOption {
  value: string;
  label: string;
  hint?: string;
}

interface GroupedPickerMenuProps {
  message?: string;
  groups: Record<string, GroupOption[]>;
  initialSelected?: string[];
  onSelect: (values: string[]) => void;
}

type Row =
  | { kind: 'header'; label: string }
  | { kind: 'option'; value: string; label: string; hint?: string };

/** Truncate text with "\u2026" if it exceeds maxWidth. */
function truncateWithEllipsis(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  return text.slice(0, maxWidth - 1) + '\u2026';
}

/** Rows consumed by chrome outside this component (title bar, screen padding, etc.) */
const CHROME_OVERHEAD = 10;
/** Rows used by the prompt label + marginTop before content (hint text moved to KeyboardHintsBar). */
const MENU_CHROME = 2;

/** Count the visual rows occupied by rows[start..end), accounting for header margins. */
function countVisualRows(rows: Row[], start: number, end: number): number {
  let count = 0;
  for (let i = start; i < end && i < rows.length; i++) {
    if (rows[i].kind === 'header' && i > start) count += 1; // marginTop gap
    count += 1;
  }
  return count;
}

/** From scrollOffset, find how many flat rows fit in the visual budget. */
function computeVisibleEnd(
  rows: Row[],
  scrollOffset: number,
  budget: number,
): number {
  let visualCount = 0;
  let i = scrollOffset;
  while (i < rows.length) {
    const cost = rows[i].kind === 'header' && i > scrollOffset ? 2 : 1;
    if (visualCount + cost > budget) break;
    visualCount += cost;
    i++;
  }
  return i;
}

/** Adjust scroll offset to keep focusedRowIdx visible within the viewport. */
function adjustScrollOffset(
  currentOffset: number,
  focusedRowIdx: number,
  rows: Row[],
  viewportBudget: number,
): number {
  const visibleEnd = computeVisibleEnd(rows, currentOffset, viewportBudget);

  // Already visible
  if (focusedRowIdx >= currentOffset && focusedRowIdx < visibleEnd) {
    return currentOffset;
  }

  // Focus moved above viewport — scroll up, including group header if adjacent
  if (focusedRowIdx < currentOffset) {
    let newOffset = focusedRowIdx;
    if (newOffset > 0 && rows[newOffset - 1]?.kind === 'header') {
      newOffset--;
    }
    return Math.max(0, newOffset);
  }

  // Focus moved below viewport — scroll down minimally
  let newOffset = currentOffset + 1;
  while (newOffset < rows.length) {
    const end = computeVisibleEnd(rows, newOffset, viewportBudget);
    if (focusedRowIdx < end) break;
    newOffset++;
  }
  return Math.min(newOffset, Math.max(0, rows.length - 1));
}

export const GroupedPickerMenu = ({
  message,
  groups,
  initialSelected,
  onSelect,
}: GroupedPickerMenuProps) => {
  const [termCols, termRows] = useStdoutDimensions();

  // Available width for option labels, after subtracting layout chrome:
  // paddingX(2) + marginLeft(2) + option marginLeft(1) + gap(1) + checkbox(2) = 8
  const labelWidth = Math.max(10, Math.min(termCols, 120) - 8);

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
  const [scrollOffset, setScrollOffset] = useState(0);

  const focusedRowIdx = selectableIndices[focusedSelectable] ?? 0;

  // Viewport budget: how many visual rows can be shown
  const viewportBudget = Math.max(5, termRows - CHROME_OVERHEAD - MENU_CHROME);
  const totalVisual = countVisualRows(rows, 0, rows.length);
  const needsScroll = totalVisual > viewportBudget;
  const effectiveBudget = needsScroll ? viewportBudget - 2 : viewportBudget;

  useKeyBindings('grouped-picker', [
    {
      match: [KeyMatch.UpArrow, KeyMatch.DownArrow],
      label: '\u2191\u2193',
      action: 'navigate',
      handler: (_input, key) => {
        let newFocused = focusedSelectable;

        if (key.upArrow) {
          newFocused =
            focusedSelectable > 0
              ? focusedSelectable - 1
              : selectableIndices.length - 1;
        }
        if (key.downArrow) {
          newFocused =
            focusedSelectable < selectableIndices.length - 1
              ? focusedSelectable + 1
              : 0;
        }

        if (newFocused !== focusedSelectable) {
          setFocusedSelectable(newFocused);
          if (needsScroll) {
            const newFocusedRowIdx = selectableIndices[newFocused] ?? 0;
            setScrollOffset((prev) =>
              adjustScrollOffset(prev, newFocusedRowIdx, rows, effectiveBudget),
            );
          }
        }
      },
    },
    {
      match: KeyMatch.Space,
      label: 'space',
      action: 'toggle',
      handler: () => {
        const targetRowIdx = selectableIndices[focusedSelectable] ?? 0;
        const row = rows[targetRowIdx];
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
      },
    },
    {
      match: 'a',
      label: 'a',
      action: 'toggle all',
      priority: 11,
      handler: () => {
        setSelected((prev) => {
          if (prev.size === allValues.length) {
            return new Set();
          }
          return new Set(allValues);
        });
      },
    },
    {
      match: KeyMatch.Return,
      label: 'enter',
      action: 'confirm',
      handler: () => {
        onSelect([...selected]);
      },
    },
  ]);

  // Determine visible slice
  const visibleStart = needsScroll ? scrollOffset : 0;
  const visibleEnd = needsScroll
    ? computeVisibleEnd(rows, visibleStart, effectiveBudget)
    : rows.length;
  const visibleRows = rows.slice(visibleStart, visibleEnd);
  const hiddenAbove = needsScroll
    ? selectableIndices.filter((s) => s < visibleStart).length
    : 0;
  const hiddenBelow = needsScroll
    ? selectableIndices.filter((s) => s >= visibleEnd).length
    : 0;

  return (
    <Box flexDirection="column">
      <PromptLabel message={message} />
      <Box flexDirection="column" marginTop={1} marginLeft={2}>
        {needsScroll && (
          <Text dimColor>
            {hiddenAbove > 0 ? `\u2191 ${hiddenAbove} more` : ' '}
          </Text>
        )}
        {visibleRows.map((row, relIdx) => {
          const absIdx = visibleStart + relIdx;

          if (row.kind === 'header') {
            return (
              <Box
                key={`h-${absIdx}`}
                marginTop={relIdx > 0 && absIdx > 0 ? 1 : 0}
              >
                <Text bold dimColor>
                  {row.label}
                </Text>
              </Box>
            );
          }

          const isFocused = focusedRowIdx === absIdx;
          const isSelected = selected.has(row.value);
          const checkbox = isSelected ? Icons.squareFilled : Icons.squareOpen;
          const fullLabel = row.hint ? `${row.label} (${row.hint})` : row.label;
          const label = truncateWithEllipsis(fullLabel, labelWidth);

          return (
            <Box key={row.value} gap={1} marginLeft={1}>
              <Text
                color={isSelected ? 'white' : Colors.muted}
                dimColor={!isFocused && !isSelected}
              >
                {checkbox}
              </Text>
              <Box flexGrow={1} flexShrink={1} overflow="hidden">
                <Text
                  color={isFocused ? Colors.accent : undefined}
                  bold={isFocused}
                  dimColor={!isFocused}
                  wrap="truncate"
                >
                  {label}
                </Text>
              </Box>
            </Box>
          );
        })}
        {needsScroll && (
          <Text dimColor>
            {hiddenBelow > 0 ? `\u2193 ${hiddenBelow} more` : ' '}
          </Text>
        )}
      </Box>
    </Box>
  );
};
