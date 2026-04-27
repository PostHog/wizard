import { Box, Text } from 'ink';
import { useMemo, useState } from 'react';
import { useStdoutDimensions } from '../../../hooks/useStdoutDimensions.js';
import type { AuditCheck } from '../../../../../lib/workflows/audit/types.js';
import { ActiveTaskBanner } from './ActiveTaskBanner.js';
import { buildRenderRows } from './buildRows.js';
import { CheckRow } from './CheckRow.js';
import { DetailRow } from './DetailRow.js';
import { EmptyState } from './EmptyState.js';
import { Footer } from './Footer.js';
import { Header, statusCounts } from './Header.js';
import { computeLayout } from './layout.js';
import { SectionLabel } from './SectionLabel.js';
import { sortChecks } from './sort.js';
import type { AuditTaskItem } from './types.js';
import { useScroll } from './useScroll.js';

interface AuditChecksViewerProps {
  checks: AuditCheck[];
  tasks: ReadonlyArray<AuditTaskItem>;
}

export const AuditChecksViewer = ({
  checks,
  tasks,
}: AuditChecksViewerProps) => {
  // First in-progress task, else first pending — drives the "Working on…" banner.
  const activeTask =
    tasks.find((t) => t.status === 'in_progress') ??
    tasks.find((t) => t.status === 'pending');

  // Layout is recomputed every render against current terminal size so the
  // viewer reflows on resize. `viewerChrome` rises by 1 when the banner is
  // present, which steals one body row in exchange.
  const [rawCols, termRows] = useStdoutDimensions();
  const layout = computeLayout(rawCols, termRows, Boolean(activeTask));
  const totalHeight = layout.visibleHeight + layout.viewerChrome;

  // Display order: pending at the top, resolved underneath by severity.
  const sorted = useMemo(() => sortChecks(checks), [checks]);

  // Each visible item is one render row; expanding adds a sibling detail row.
  // Section headers and the pending/complete separator are also rows so the
  // scroll math operates in a single "row count" number.
  const [expanded, setExpanded] = useState(false);
  const rows = useMemo(
    () => buildRenderRows(sorted, expanded),
    [sorted, expanded],
  );
  const hasExpandable = useMemo(
    () => sorted.some((c) => Boolean(c.details)),
    [sorted],
  );

  // Sticky-to-top scrolling: the viewport tracks offset 0 until the user
  // explicitly scrolls down. Keybindings (↑↓, u/d, e) live in the hook.
  const { offset } = useScroll({
    rowCount: rows.length,
    visibleHeight: layout.visibleHeight,
    hasExpandable,
    expanded,
    toggleExpanded: () => setExpanded((prev) => !prev),
  });

  if (checks.length === 0) {
    return <EmptyState cols={layout.cols} height={totalHeight} />;
  }

  // Slice the row list against the scroll viewport. `hiddenAbove` /
  // `hiddenBelow` drive the "↑ N more" / "↓ N more" markers.
  const visibleRows = rows.slice(offset, offset + layout.visibleHeight);
  const hiddenAbove = offset;
  const hiddenBelow = Math.max(0, rows.length - offset - layout.visibleHeight);

  return (
    // Outer Box pins the height so chrome (banner / header / footer) and
    // body together exactly fill the slot RunScreen reserves for this tab.
    <Box flexDirection="column" paddingX={1} height={totalHeight}>
      {activeTask && <ActiveTaskBanner task={activeTask} />}
      <Header
        total={checks.length}
        counts={statusCounts(checks)}
        layout={layout}
      />
      <Text dimColor>{hiddenAbove > 0 ? `↑ ${hiddenAbove} more` : ' '}</Text>
      <Box
        flexDirection="column"
        height={layout.visibleHeight}
        overflow="hidden"
      >
        {/* Render-row dispatch: each kind maps to a dedicated atomic component. */}
        {visibleRows.map((row, i) => {
          const key = `${offset + i}`;
          if (row.kind === 'separator') {
            return (
              <Box key={key} flexShrink={0}>
                <Text> </Text>
              </Box>
            );
          }
          if (row.kind === 'section') {
            return (
              <SectionLabel key={`${key}-${row.label}`} label={row.label} />
            );
          }
          if (row.kind === 'detail') {
            return (
              <DetailRow
                key={`${key}-detail-${row.item.id}`}
                item={row.item}
                layout={layout}
              />
            );
          }
          return (
            <CheckRow
              key={`${key}-${row.item.id}`}
              item={row.item}
              layout={layout}
            />
          );
        })}
      </Box>
      <Footer hiddenBelow={hiddenBelow} />
    </Box>
  );
};
