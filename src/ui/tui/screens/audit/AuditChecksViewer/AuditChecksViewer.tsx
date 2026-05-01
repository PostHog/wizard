/**
 * AuditChecksViewer — "Audit plan" tab.
 *
 * Renders the full audit ledger as a scrollable table grouped by status:
 * resolved checks (issues + passes, sorted by severity) on top, pending
 * checks at the bottom, separated by a blank row.
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
import { CheckRow } from './CheckRow.js';
import { DetailRow } from './DetailRow.js';
import { EmptyState } from './EmptyState.js';
import { Footer } from './Footer.js';
import { Header, statusCounts } from './Header.js';
import { computeLayout } from './layout.js';
import { sortChecks } from './sort.js';

interface AuditChecksViewerProps {
  checks: AuditCheck[];
}

export const AuditChecksViewer = ({ checks }: AuditChecksViewerProps) => {
  // ── Layout ─────────────────────────────────────────────────────────
  // Recompute on every render against current terminal size so the viewer
  // reflows on resize. `viewerChrome` is the row count consumed by header,
  // dividers, scroll markers, legend, and counts; `visibleHeight` is what
  // remains for the scrollable body.
  const [rawCols, termRows] = useStdoutDimensions();
  const layout = computeLayout(rawCols, termRows);
  const totalHeight = layout.visibleHeight + layout.viewerChrome;

  // ── Sort + section split ───────────────────────────────────────────
  // Issues + passes on top, pending at the bottom. The JSX renders the
  // two sections in that order with a blank-line separator between them.
  const sorted = useMemo(() => sortChecks(checks), [checks]);
  const resolved = sorted.filter((c) => c.status !== 'pending');
  const pending = sorted.filter((c) => c.status === 'pending');

  // ── Expand state ───────────────────────────────────────────────────
  const hasExpandable = sorted.some((c) => Boolean(c.details || c.file));
  const hasIssues = sorted.some(
    (c) =>
      c.status === 'error' ||
      c.status === 'warning' ||
      c.status === 'suggestion',
  );
  // Auto-expand when there are issues — the AuditAreaPane's `[→] View
  // issues` hint sends users here specifically to read details.
  const [expanded, setExpanded] = useState(hasIssues && hasExpandable);

  // ── Flat row list ──────────────────────────────────────────────────
  // Build one ReactNode per visible terminal row so scroll math is a
  // single number. CheckRow = 1 row; an expanded DetailRow ≈ 1 (long
  // details that wrap will overflow — we don't track exact heights, the
  // approximation is fine for a status pane).
  const allRows = useMemo<ReactNode[]>(() => {
    const rows: ReactNode[] = [];
    const buildRow = (item: AuditCheck) => {
      rows.push(<CheckRow key={item.id} item={item} layout={layout} />);
      if (expanded && (item.details || item.file)) {
        rows.push(
          <DetailRow key={`${item.id}-detail`} item={item} layout={layout} />,
        );
      }
    };
    resolved.forEach(buildRow);
    if (resolved.length > 0 && pending.length > 0) {
      rows.push(<Box key="separator" height={1} />);
    }
    pending.forEach(buildRow);
    return rows;
  }, [resolved, pending, expanded, layout]);

  // ── Scroll viewport ────────────────────────────────────────────────
  // `offset` is the index of the first visible row. Clamped on every
  // render so resizing or collapsing details can't leave us scrolled
  // past the new end. `hiddenAbove` / `hiddenBelow` drive the
  // "↑ N more" / "↓ N more" markers above and below the body.
  const [offset, setOffset] = useState(0);
  const maxOffset = Math.max(0, allRows.length - layout.visibleHeight);
  const clampedOffset = Math.min(offset, maxOffset);
  const hiddenAbove = clampedOffset;
  const hiddenBelow = Math.max(
    0,
    allRows.length - clampedOffset - layout.visibleHeight,
  );

  // ── Key bindings ───────────────────────────────────────────────────
  // `e` toggles detail rows (only registered when there's something to
  // expand). `↑`/`↓` always register so the hints bar consistently
  // advertises scroll, even when content fits and the handler is a
  // no-op via the clamp.
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
  if (checks.length === 0) {
    return <EmptyState cols={layout.cols} height={totalHeight} />;
  }

  const visibleRows = allRows.slice(
    clampedOffset,
    clampedOffset + layout.visibleHeight,
  );

  return (
    <Box flexDirection="column" paddingX={1} height={totalHeight}>
      {/* Title */}
      <Text bold>Audit plan</Text>
      <Text dimColor>
        Read-only review of installation, identification, and event capture
      </Text>
      <Box height={1} />

      {/* Column headers + divider */}
      <Header layout={layout} />
      <Text dimColor>{'─'.repeat(layout.dividerWidth)}</Text>

      {/* Scroll-up marker (renders a blank row when nothing is hidden
          above so the body's vertical position stays stable) */}
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

      {/* Scroll-down marker (mirror of the above) */}
      <Text dimColor>{hiddenBelow > 0 ? `↓ ${hiddenBelow} more` : ' '}</Text>

      {/* Legend + count summary */}
      <Footer total={checks.length} counts={statusCounts(checks)} />
    </Box>
  );
};
