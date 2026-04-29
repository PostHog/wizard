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

interface AuditChecksViewerProps {
  checks: AuditCheck[];
  currentStatus: string | undefined;
}

export const AuditChecksViewer = ({
  checks,
  currentStatus,
}: AuditChecksViewerProps) => {
  const [rawCols, termRows] = useStdoutDimensions();
  const layout = computeLayout(rawCols, termRows, Boolean(currentStatus));
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
      {currentStatus && <ActiveTaskBanner status={currentStatus} />}
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
        <Box height={1} />
        <Text bold color="cyan">
          Pending
        </Text>
        <Box height={1} />
        {pending.map(renderItem)}
        <Box height={2} />
        <Text bold color="cyan">
          Complete
        </Text>
        <Box height={1} />
        {complete.map(renderItem)}
      </Box>
      <Footer />
    </Box>
  );
};
