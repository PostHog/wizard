/**
 * GroupedPickerMenu — Multi-select with category headers.
 *
 * Renders groups of options with bold category labels.
 * Arrow keys navigate selectable items (headers are skipped),
 * space toggles, "a" toggles all, enter submits.
 *
 * Supports multi-column layout via the optional `columns` prop.
 * When columns > 1, options are arranged side-by-side and
 * left/right arrows move between columns within a row.
 *
 * When content exceeds available terminal height, the list scrolls
 * to keep the focused item visible with ↑/↓ indicators.
 */

import { Box, Text, useInput } from 'ink';
import { useState, useMemo } from 'react';
import { Icons, Colors } from '../styles.js';
import { PromptLabel } from './PromptLabel.js';
import { useStdoutDimensions } from '../hooks/useStdoutDimensions.js';

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
  columns?: number;
}

// A visual row is either a full-width header or a row of 1..N options
type VisualRow =
  | { kind: 'header'; label: string }
  | { kind: 'option-row'; options: GroupOption[] };

/** Truncate text with "…" if it exceeds maxWidth. */
function truncateWithEllipsis(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  return text.slice(0, maxWidth - 1) + '…';
}

/** Rows consumed by chrome outside this component (title bar, screen padding, etc.) */
const CHROME_OVERHEAD = 10;
/** Rows used by the prompt label, hint text, and marginTop before content. */
const MENU_CHROME = 3;

/** Build visual rows from groups, chunking each group's options into rows of `cols`. */
function buildVisualRows(
  groups: Record<string, GroupOption[]>,
  cols: number,
): VisualRow[] {
  const result: VisualRow[] = [];
  for (const [groupName, options] of Object.entries(groups)) {
    result.push({ kind: 'header', label: groupName });
    for (let i = 0; i < options.length; i += cols) {
      result.push({ kind: 'option-row', options: options.slice(i, i + cols) });
    }
  }
  return result;
}

/** Count visual lines occupied by visualRows[start..end). Headers after the first get a margin gap. */
function countVisualLines(
  vRows: VisualRow[],
  start: number,
  end: number,
): number {
  let count = 0;
  for (let i = start; i < end && i < vRows.length; i++) {
    if (vRows[i].kind === 'header' && i > start) count += 1; // marginTop gap
    count += 1;
  }
  return count;
}

/** From scrollOffset, find how many visual rows fit in the budget. */
function computeVisibleEnd(
  vRows: VisualRow[],
  scrollOffset: number,
  budget: number,
): number {
  let lines = 0;
  let i = scrollOffset;
  while (i < vRows.length) {
    const cost = vRows[i].kind === 'header' && i > scrollOffset ? 2 : 1;
    if (lines + cost > budget) break;
    lines += cost;
    i++;
  }
  return i;
}

/** Adjust scroll offset to keep targetIdx visible within the viewport. */
function adjustScrollOffset(
  currentOffset: number,
  targetIdx: number,
  vRows: VisualRow[],
  budget: number,
): number {
  const visibleEnd = computeVisibleEnd(vRows, currentOffset, budget);

  // Already visible
  if (targetIdx >= currentOffset && targetIdx < visibleEnd) {
    return currentOffset;
  }

  // Focus moved above viewport — scroll up, including group header if adjacent
  if (targetIdx < currentOffset) {
    let newOffset = targetIdx;
    if (newOffset > 0 && vRows[newOffset - 1]?.kind === 'header') {
      newOffset--;
    }
    return Math.max(0, newOffset);
  }

  // Focus moved below viewport — scroll down minimally
  let newOffset = currentOffset + 1;
  while (newOffset < vRows.length) {
    const end = computeVisibleEnd(vRows, newOffset, budget);
    if (targetIdx < end) break;
    newOffset++;
  }
  return Math.min(newOffset, Math.max(0, vRows.length - 1));
}

/** Count individual options within a slice of visual rows. */
function countOptionsInSlice(
  vRows: VisualRow[],
  start: number,
  end: number,
): number {
  let count = 0;
  for (let i = start; i < end && i < vRows.length; i++) {
    const vr = vRows[i];
    if (vr.kind === 'option-row') count += vr.options.length;
  }
  return count;
}

export const GroupedPickerMenu = ({
  message,
  groups,
  initialSelected,
  onSelect,
  columns = 1,
}: GroupedPickerMenuProps) => {
  const [termCols, termRows] = useStdoutDimensions();
  const cols = Math.max(1, columns);

  // Build visual rows: headers + chunked option-rows
  const visualRows = useMemo(
    () => buildVisualRows(groups, cols),
    [groups, cols],
  );

  // Indices of selectable visual rows (option-rows, not headers)
  const selectableIndices = useMemo(
    () =>
      visualRows
        .map((vr, i) => (vr.kind === 'option-row' ? i : -1))
        .filter((i) => i >= 0),
    [visualRows],
  );

  // All option values for toggle-all
  const allValues = useMemo(
    () =>
      visualRows
        .filter(
          (vr): vr is Extract<VisualRow, { kind: 'option-row' }> =>
            vr.kind === 'option-row',
        )
        .flatMap((vr) => vr.options.map((o) => o.value)),
    [visualRows],
  );

  // Label width per column, accounting for multi-column gaps
  const gapBetween = cols > 1 ? 2 : 0;
  const perColumnChrome = 4; // marginLeft(1) + checkbox(2) + gap(1)
  const totalAvailable = Math.max(20, Math.min(termCols, 120) - 8);
  const colWidth = Math.floor(totalAvailable / cols);
  const labelWidth = Math.max(10, colWidth - perColumnChrome - gapBetween);

  // Focus state: which option-row and which column within it
  const [focusedRow, setFocusedRow] = useState(0);
  const [focusedCol, setFocusedCol] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialSelected ?? allValues),
  );
  const [scrollOffset, setScrollOffset] = useState(0);

  const focusedVisualIdx = selectableIndices[focusedRow] ?? 0;
  const focusedOptionRow = visualRows[focusedVisualIdx];
  const focusedRowWidth =
    focusedOptionRow?.kind === 'option-row'
      ? focusedOptionRow.options.length
      : 1;

  // Viewport budget: how many visual lines can be shown
  const viewportBudget = Math.max(5, termRows - CHROME_OVERHEAD - MENU_CHROME);
  const totalVisual = countVisualLines(visualRows, 0, visualRows.length);
  const needsScroll = totalVisual > viewportBudget;
  const effectiveBudget = needsScroll ? viewportBudget - 2 : viewportBudget;

  useInput((input, key) => {
    let newRow = focusedRow;
    let newCol = focusedCol;

    if (key.upArrow) {
      newRow = focusedRow > 0 ? focusedRow - 1 : selectableIndices.length - 1;
    }
    if (key.downArrow) {
      newRow = focusedRow < selectableIndices.length - 1 ? focusedRow + 1 : 0;
    }
    if (key.leftArrow && cols > 1) {
      newCol = Math.max(0, focusedCol - 1);
    }
    if (key.rightArrow && cols > 1) {
      newCol = Math.min(focusedRowWidth - 1, focusedCol + 1);
    }

    // Clamp column to new row's width (last row may have fewer items)
    if (newRow !== focusedRow) {
      const newVisualIdx = selectableIndices[newRow] ?? 0;
      const newOptionRow = visualRows[newVisualIdx];
      const newRowWidth =
        newOptionRow?.kind === 'option-row' ? newOptionRow.options.length : 1;
      newCol = Math.min(newCol, newRowWidth - 1);
    }

    if (newRow !== focusedRow || newCol !== focusedCol) {
      setFocusedRow(newRow);
      setFocusedCol(newCol);
      if (needsScroll) {
        const newVisualIdx = selectableIndices[newRow] ?? 0;
        setScrollOffset((prev) =>
          adjustScrollOffset(prev, newVisualIdx, visualRows, effectiveBudget),
        );
      }
    }

    if (input === ' ') {
      const visualIdx = selectableIndices[newRow] ?? 0;
      const optionRow = visualRows[visualIdx];
      if (optionRow?.kind === 'option-row') {
        const opt = optionRow.options[newCol];
        if (opt) {
          setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(opt.value)) {
              next.delete(opt.value);
            } else {
              next.add(opt.value);
            }
            return next;
          });
        }
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

  // Determine visible slice
  const visibleStart = needsScroll ? scrollOffset : 0;
  const visibleEnd = needsScroll
    ? computeVisibleEnd(visualRows, visibleStart, effectiveBudget)
    : visualRows.length;
  const visibleSlice = visualRows.slice(visibleStart, visibleEnd);
  const hiddenAbove = needsScroll
    ? countOptionsInSlice(visualRows, 0, visibleStart)
    : 0;
  const hiddenBelow = needsScroll
    ? countOptionsInSlice(visualRows, visibleEnd, visualRows.length)
    : 0;

  return (
    <Box flexDirection="column">
      <PromptLabel message={message} />
      <Text dimColor>
        {' '}
        (space to toggle, a to toggle all, enter to confirm)
      </Text>
      <Box flexDirection="column" marginTop={1} marginLeft={2}>
        {needsScroll && (
          <Text dimColor>
            {hiddenAbove > 0 ? `↑ ${hiddenAbove} more` : ' '}
          </Text>
        )}
        {visibleSlice.map((vRow, relIdx) => {
          const absIdx = visibleStart + relIdx;

          if (vRow.kind === 'header') {
            return (
              <Box
                key={`h-${absIdx}`}
                marginTop={relIdx > 0 && absIdx > 0 ? 1 : 0}
              >
                <Text bold dimColor>
                  {vRow.label}
                </Text>
              </Box>
            );
          }

          // Option-row: render columns side by side
          const isThisFocusedRow = absIdx === focusedVisualIdx;

          return (
            <Box key={`r-${absIdx}`} flexDirection="row" gap={gapBetween}>
              {vRow.options.map((opt, colIdx) => {
                const isFocused = isThisFocusedRow && colIdx === focusedCol;
                const isSelected = selected.has(opt.value);
                const checkbox = isSelected
                  ? Icons.squareFilled
                  : Icons.squareOpen;
                const fullLabel = opt.hint
                  ? `${opt.label} (${opt.hint})`
                  : opt.label;
                const label = truncateWithEllipsis(fullLabel, labelWidth);

                return (
                  <Box key={opt.value} gap={1} marginLeft={1} width={colWidth}>
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
            </Box>
          );
        })}
        {needsScroll && (
          <Text dimColor>
            {hiddenBelow > 0 ? `↓ ${hiddenBelow} more` : ' '}
          </Text>
        )}
      </Box>
    </Box>
  );
};
