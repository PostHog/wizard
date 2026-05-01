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
  const [rawCols, termRows] = useStdoutDimensions();
  const layout = computeLayout(rawCols, termRows);
  const totalHeight = layout.visibleHeight + layout.viewerChrome;

  // Issues + passes on top, pending at the bottom. The JSX renders the two
  // sections in that order with a blank-line separator between them.
  const sorted = useMemo(() => sortChecks(checks), [checks]);
  const resolved = sorted.filter((c) => c.status !== 'pending');
  const pending = sorted.filter((c) => c.status === 'pending');

  const hasExpandable = sorted.some((c) => Boolean(c.details || c.file));
  const hasIssues = sorted.some(
    (c) =>
      c.status === 'error' ||
      c.status === 'warning' ||
      c.status === 'suggestion',
  );
  // Auto-expand when there are issues to show — users land on this tab via
  // the "View issues" hint specifically to read the details.
  const [expanded, setExpanded] = useState(hasIssues && hasExpandable);

  // Build a flat row list so scroll math is one number. CheckRow = 1 row,
  // DetailRow ≈ 1 (long details that wrap will overflow but that's acceptable
  // for a status pane — exact pixel-perfect height tracking isn't worth it).
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

  const [offset, setOffset] = useState(0);
  const maxOffset = Math.max(0, allRows.length - layout.visibleHeight);
  const clampedOffset = Math.min(offset, maxOffset);
  const hiddenAbove = clampedOffset;
  const hiddenBelow = Math.max(
    0,
    allRows.length - clampedOffset - layout.visibleHeight,
  );

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

  if (checks.length === 0) {
    return <EmptyState cols={layout.cols} height={totalHeight} />;
  }

  const visibleRows = allRows.slice(
    clampedOffset,
    clampedOffset + layout.visibleHeight,
  );

  return (
    <Box flexDirection="column" paddingX={1} height={totalHeight}>
      <Text bold>Audit plan</Text>
      <Text dimColor>
        Read-only review of installation, identification, and event capture
      </Text>
      <Box height={1} />
      <Header layout={layout} />
      <Text dimColor>{'─'.repeat(layout.dividerWidth)}</Text>
      <Text dimColor>{hiddenAbove > 0 ? `↑ ${hiddenAbove} more` : ' '}</Text>
      <Box
        flexDirection="column"
        height={layout.visibleHeight}
        overflow="hidden"
      >
        {visibleRows.map((node, i) => (
          <Fragment key={`row-${clampedOffset + i}`}>{node}</Fragment>
        ))}
      </Box>
      <Text dimColor>{hiddenBelow > 0 ? `↓ ${hiddenBelow} more` : ' '}</Text>
      <Footer total={checks.length} counts={statusCounts(checks)} />
    </Box>
  );
};
