import { Box, Text } from 'ink';
import { Fragment, useMemo, useState } from 'react';
import { useStdoutDimensions } from '../../../hooks/useStdoutDimensions.js';
import { useKeyBindings } from '../../../hooks/useKeyBindings.js';
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

  // Pending at top, complete below — split here once and the JSX below
  // structurally renders the two sections in order.
  const sorted = useMemo(() => sortChecks(checks), [checks]);
  const pending = sorted.filter((c) => c.status === 'pending');
  const complete = sorted.filter((c) => c.status !== 'pending');

  const [expanded, setExpanded] = useState(false);
  const hasExpandable = sorted.some((c) => Boolean(c.details || c.file));
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
      {expanded && (item.details || item.file) && (
        <DetailRow item={item} layout={layout} />
      )}
    </Fragment>
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
      <Box
        flexDirection="column"
        height={layout.visibleHeight}
        overflow="hidden"
      >
        {pending.map(renderItem)}
        {pending.length > 0 && complete.length > 0 && <Box height={1} />}
        {complete.map(renderItem)}
      </Box>
      <Footer total={checks.length} counts={statusCounts(checks)} />
    </Box>
  );
};
