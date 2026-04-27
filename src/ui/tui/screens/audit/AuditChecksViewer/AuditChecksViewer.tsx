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

  const [rawCols, termRows] = useStdoutDimensions();
  const layout = computeLayout(rawCols, termRows, Boolean(activeTask));
  const totalHeight = layout.visibleHeight + layout.viewerChrome;

  const sorted = useMemo(() => sortChecks(checks), [checks]);

  const [expanded, setExpanded] = useState(false);
  const rows = useMemo(
    () => buildRenderRows(sorted, expanded),
    [sorted, expanded],
  );
  const hasExpandable = useMemo(
    () => sorted.some((c) => Boolean(c.details)),
    [sorted],
  );

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

  const visibleRows = rows.slice(offset, offset + layout.visibleHeight);
  const hiddenAbove = offset;
  const hiddenBelow = Math.max(0, rows.length - offset - layout.visibleHeight);

  return (
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
