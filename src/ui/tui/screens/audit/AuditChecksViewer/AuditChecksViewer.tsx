/**
 * AuditChecksViewer — "Audit plan" tab.
 *
 * Renders the full audit ledger as a scrollable, area-grouped list that
 * mirrors the structure of the final report. Each area gets a sub-header
 * with a resolved/total count; checks within an area are sorted by
 * severity (error → warning → suggestion → pass → pending).
 *
 * Two interactions, both registered via `useKeyBindings`:
 *   - `e`        — toggle detail rows (file:line + agent's `details` text)
 *   - `↑` / `↓`  — scroll one row at a time, clamped to content bounds
 *
 * Auto-expands on first mount when the ledger contains any issue, since
 * the AuditAreaPane's `[→] View issues` hint sends users here precisely
 * to read those details.
 */

import { Box, Text } from 'ink';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { useStdoutDimensions } from '../../../hooks/useStdoutDimensions.js';
import {
  KeyMatch,
  useKeyBindings,
  type KeyBinding,
} from '../../../hooks/useKeyBindings.js';
import type { AuditCheck } from '../../../../../lib/workflows/audit/types.js';
import { AreaHeaderRow } from './AreaHeaderRow.js';
import { CheckRow } from './CheckRow.js';
import { DetailRow } from './DetailRow.js';
import { Footer } from './Footer.js';
import { Header, Summary, statusCounts } from './Header.js';
import { computeLayout } from './layout.js';
import { groupChecksByArea } from './sort.js';

interface AuditChecksViewerProps {
  checks: AuditCheck[];
}

export const AuditChecksViewer = ({ checks }: AuditChecksViewerProps) => {
  // ── Layout ─────────────────────────────────────────────────────────
  const [rawCols, termRows] = useStdoutDimensions();
  const layout = computeLayout(rawCols, termRows);
  const totalHeight = layout.visibleHeight + layout.viewerChrome;

  // ── Group by area ──────────────────────────────────────────────────
  const groups = useMemo(() => groupChecksByArea(checks), [checks]);
  const counts = useMemo(() => statusCounts(checks), [checks]);

  // ── Expand state ───────────────────────────────────────────────────
  const hasExpandable = checks.some((c) => Boolean(c.details || c.file));
  const hasIssues = checks.some(
    (c) =>
      c.status === 'error' ||
      c.status === 'warning' ||
      c.status === 'suggestion',
  );
  const [expanded, setExpanded] = useState(hasIssues && hasExpandable);

  // ── Flat row list ──────────────────────────────────────────────────
  // One ReactNode per visible terminal row so scroll math stays simple.
  // Sub-header + check rows + (optional) detail rows interleave here.
  const allRows = useMemo<ReactNode[]>(() => {
    const rows: ReactNode[] = [];
    for (const group of groups) {
      rows.push(
        <AreaHeaderRow
          key={`header-${group.area}`}
          area={group.area}
          resolved={group.counts.resolved}
          total={group.counts.total}
        />,
      );
      for (const item of group.checks) {
        rows.push(<CheckRow key={item.id} item={item} layout={layout} />);
        if (expanded && (item.details || item.file)) {
          rows.push(
            <DetailRow key={`${item.id}-detail`} item={item} layout={layout} />,
          );
        }
      }
    }
    return rows;
  }, [groups, expanded, layout]);

  // ── Scroll viewport ────────────────────────────────────────────────
  const [offset, setOffset] = useState(0);
  const maxOffset = Math.max(0, allRows.length - layout.visibleHeight);
  const clampedOffset = Math.min(offset, maxOffset);
  const hiddenAbove = clampedOffset;
  const hiddenBelow = Math.max(
    0,
    allRows.length - clampedOffset - layout.visibleHeight,
  );

  // ── Key bindings ───────────────────────────────────────────────────
  const bindings: KeyBinding[] = [];
  if (hasExpandable) {
    bindings.push({
      match: 'e',
      label: 'e',
      action: expanded ? 'collapse details' : 'expand details',
      handler: () => setExpanded((prev) => !prev),
    });
  }
  bindings.push({
    match: [KeyMatch.UpArrow, KeyMatch.DownArrow],
    label: '↑↓',
    action: 'scroll',
    handler: (_input, key) => {
      if (key.upArrow) setOffset((o) => Math.max(0, o - 1));
      else if (key.downArrow) setOffset((o) => Math.min(maxOffset, o + 1));
    },
  });
  useKeyBindings('audit-checks-viewer', bindings);

  // ── Render ─────────────────────────────────────────────────────────
  const visibleRows = allRows.slice(
    clampedOffset,
    clampedOffset + layout.visibleHeight,
  );

  // Dynamic subtitle — lists the actual areas in the ledger.
  const subtitle =
    groups.length === 0
      ? 'No checks yet.'
      : `Review across ${groups.length} ${
          groups.length === 1 ? 'area' : 'areas'
        } — mirrors the final report.`;

  return (
    <Box flexDirection="column" paddingX={1} height={totalHeight}>
      {/* Title + dynamic subtitle */}
      <Text bold>Audit plan</Text>
      <Text dimColor>{subtitle}</Text>

      {/* Top summary — same as Footer summary, promoted here for at-a-glance */}
      <Summary total={checks.length} counts={counts} />
      <Box height={1} />

      {/* Column headers + divider */}
      <Header layout={layout} />
      <Text dimColor>{'─'.repeat(layout.dividerWidth)}</Text>

      {/* Scroll-up marker */}
      <Text dimColor>{hiddenAbove > 0 ? `↑ ${hiddenAbove} more` : ' '}</Text>

      {/* Scrollable body */}
      <Box
        flexDirection="column"
        height={layout.visibleHeight}
        overflow="hidden"
      >
        {visibleRows.map((node, i) => (
          <Fragment key={`row-${clampedOffset + i}`}>{node}</Fragment>
        ))}
      </Box>

      {/* Scroll-down marker */}
      <Text dimColor>{hiddenBelow > 0 ? `↓ ${hiddenBelow} more` : ' '}</Text>

      {/* Legend (counts already shown at the top) */}
      <Footer total={checks.length} counts={counts} />
    </Box>
  );
};
