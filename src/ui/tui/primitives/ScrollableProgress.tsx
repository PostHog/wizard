/**
 * ScrollableProgress — Height-aware progress list with auto-scroll and keyboard navigation.
 *
 * Renders multiple progress groups (base tasks + per-migration groups) within
 * a fixed height budget. Auto-scrolls to keep the active (in_progress) item
 * visible, and supports j/k keys for manual scrolling.
 *
 * When all content fits, renders everything without scroll indicators.
 */

import { Box, Text, useInput } from 'ink';
import { useState, useEffect, useMemo } from 'react';
import { Spinner } from '@inkjs/ui';
import { Colors, Icons } from '../styles.js';
import type { ProgressItem } from './ProgressList.js';

export interface ProgressGroup {
  title: string;
  items: ProgressItem[];
  /** Show failure indicator next to title */
  failed?: boolean;
}

interface ScrollableProgressProps {
  groups: ProgressGroup[];
  /** Maximum height in terminal rows. When omitted, renders without scrolling. */
  maxHeight?: number;
}

/** A virtual line in the flattened list — either a group header, item, spacing, or summary. */
type VirtualLine =
  | { kind: 'title'; text: string; bold: boolean }
  | { kind: 'spacing' }
  | {
      kind: 'item';
      icon: string;
      iconColor: string;
      label: string;
      dimLabel: boolean;
      isActive: boolean;
    }
  | { kind: 'summary'; completed: number; total: number };

function buildVirtualLines(groups: ProgressGroup[]): VirtualLine[] {
  const lines: VirtualLine[] = [];

  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];

    // Group spacing (except before the first group)
    if (g > 0) {
      lines.push({ kind: 'spacing' });
    }

    // Title
    lines.push({
      kind: 'title',
      text: group.failed ? `${group.title} (failed)` : group.title,
      bold: true,
    });
    lines.push({ kind: 'spacing' });

    // Items
    if (group.items.length === 0) {
      lines.push({
        kind: 'item',
        icon: Icons.triangleRight,
        iconColor: Colors.primary,
        label: 'Analyzing...',
        dimLabel: true,
        isActive: true,
      });
    } else {
      for (const item of group.items) {
        const icon =
          item.status === 'completed'
            ? Icons.squareFilled
            : item.status === 'in_progress'
            ? Icons.triangleRight
            : Icons.squareOpen;
        const iconColor =
          item.status === 'completed'
            ? Colors.success
            : item.status === 'in_progress'
            ? Colors.primary
            : Colors.muted;
        const label =
          item.status === 'in_progress' && item.activeForm
            ? item.activeForm
            : item.label;

        lines.push({
          kind: 'item',
          icon,
          iconColor,
          label,
          dimLabel: item.status === 'pending',
          isActive: item.status === 'in_progress',
        });
      }

      // Summary line
      const completed = group.items.filter(
        (t) => t.status === 'completed',
      ).length;
      lines.push({
        kind: 'summary',
        completed,
        total: group.items.length,
      });
    }
  }

  return lines;
}

export const ScrollableProgress = ({
  groups,
  maxHeight,
}: ScrollableProgressProps) => {
  const lines = useMemo(() => buildVirtualLines(groups), [groups]);
  const totalHeight = lines.length;

  // Find the first active (in_progress) line index for auto-scroll
  const activeIdx = useMemo(
    () => lines.findIndex((l) => l.kind === 'item' && l.isActive),
    [lines],
  );

  const needsScroll = maxHeight != null && totalHeight > maxHeight;
  // Reserve 1 row each for ▲/▼ indicators when scrolling
  const viewportHeight = needsScroll ? maxHeight - 2 : totalHeight;

  const [scrollOffset, setScrollOffset] = useState(0);
  const [manualScroll, setManualScroll] = useState(false);

  // Auto-scroll to keep active item in view (unless user is manually scrolling)
  useEffect(() => {
    if (!needsScroll || manualScroll) return;

    if (activeIdx >= 0) {
      // Center the active item in the viewport
      const target = Math.max(
        0,
        Math.min(
          activeIdx - Math.floor(viewportHeight / 2),
          totalHeight - viewportHeight,
        ),
      );
      setScrollOffset(target);
    }
  }, [activeIdx, needsScroll, manualScroll, viewportHeight, totalHeight]);

  // Reset manual scroll when active item changes
  useEffect(() => {
    setManualScroll(false);
  }, [activeIdx]);

  useInput((input, key) => {
    if (!needsScroll) return;

    if (key.downArrow || input === 'j') {
      setManualScroll(true);
      setScrollOffset((prev) =>
        Math.min(prev + 1, totalHeight - viewportHeight),
      );
    }
    if (key.upArrow || input === 'k') {
      setManualScroll(true);
      setScrollOffset((prev) => Math.max(prev - 1, 0));
    }
  });

  // Determine visible slice
  const visibleStart = needsScroll ? scrollOffset : 0;
  const visibleEnd = visibleStart + viewportHeight;
  const visibleLines = lines.slice(visibleStart, visibleEnd);

  const canScrollUp = needsScroll && scrollOffset > 0;
  const canScrollDown =
    needsScroll && scrollOffset + viewportHeight < totalHeight;

  return (
    <Box flexDirection="column" height={maxHeight}>
      {canScrollUp && (
        <Text dimColor> ▲ {scrollOffset} more above (k/↑ to scroll)</Text>
      )}
      {!canScrollUp && needsScroll && <Text> </Text>}

      {visibleLines.map((line, i) => {
        switch (line.kind) {
          case 'title':
            return (
              <Text key={`${visibleStart + i}`} bold={line.bold}>
                {line.text}
              </Text>
            );
          case 'spacing':
            return <Text key={`${visibleStart + i}`}> </Text>;
          case 'item':
            return (
              <Text key={`${visibleStart + i}`}>
                <Text color={line.iconColor}>{line.icon}</Text>
                <Text dimColor={line.dimLabel}> {line.label}</Text>
              </Text>
            );
          case 'summary':
            return (
              <Box key={`${visibleStart + i}`} marginTop={1} gap={1}>
                <Spinner />
                <Text dimColor>
                  {line.completed < line.total
                    ? `Progress: ${line.completed}/${line.total} completed`
                    : 'Cleaning up...'}
                </Text>
              </Box>
            );
        }
      })}

      {canScrollDown && (
        <Text dimColor>
          {' '}
          ▼ {totalHeight - scrollOffset - viewportHeight} more below (j/↓ to
          scroll)
        </Text>
      )}
      {!canScrollDown && needsScroll && <Text> </Text>}
    </Box>
  );
};
