import { Box, Text } from 'ink';
import { Fragment, useMemo, useState } from 'react';
import { useStdoutDimensions } from '../../../hooks/useStdoutDimensions.js';
import { useKeyBindings } from '../../../hooks/useKeyBindings.js';
import type { AuditCheck } from '../../../../../lib/workflows/audit/types.js';
import { ActiveTaskBanner } from './ActiveTaskBanner.js';
import { CheckRow } from './CheckRow.js';
import { DetailRow } from './DetailRow.js';
import { EmptyState } from './EmptyState.js';
import { Footer } from './Footer.js';
import { Header, statusCounts } from './Header.js';
import { computeLayout } from './layout.js';
import { sortChecks } from './sort.js';
import type { AuditTaskItem } from './types.js';

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

  // Pending at top, complete below — split here once and the JSX below
  // structurally renders the two sections in order.
  const sorted = useMemo(() => sortChecks(checks), [checks]);
  const pending = sorted.filter((c) => c.status === 'pending');
  const complete = sorted.filter((c) => c.status !== 'pending');

  const [expanded, setExpanded] = useState(false);
  const hasExpandable = sorted.some((c) => Boolean(c.details));
  useKeyBindings(
    'audit-checks-viewer',
    hasExpandable
      ? [
          {
            match: 'e',
            label: 'e',
            action: expanded ? 'collapse details' : 'expand details',
            handler: () => setExpanded((prev) => !prev),
          },
        ]
      : [],
  );

  if (checks.length === 0) {
    return <EmptyState cols={layout.cols} height={totalHeight} />;
  }

  const renderItem = (item: AuditCheck) => (
    <Fragment key={item.id}>
      <CheckRow item={item} layout={layout} />
      {expanded && item.details && <DetailRow item={item} layout={layout} />}
    </Fragment>
  );

  return (
    <Box flexDirection="column" paddingX={1} height={totalHeight}>
      {activeTask && <ActiveTaskBanner task={activeTask} />}
      <Header
        total={checks.length}
        counts={statusCounts(checks)}
        layout={layout}
      />
      <Box
        flexDirection="column"
        height={layout.visibleHeight}
        overflow="hidden"
      >
        <Text bold color="cyan">
          Pending
        </Text>
        {pending.map(renderItem)}
        <Box height={2} />
        <Text bold color="cyan">
          Complete
        </Text>
        {complete.map(renderItem)}
      </Box>
      <Footer />
    </Box>
  );
};
