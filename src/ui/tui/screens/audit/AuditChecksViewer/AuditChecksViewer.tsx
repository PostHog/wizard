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
        {resolved.map(renderItem)}
        {resolved.length > 0 && pending.length > 0 && <Box height={1} />}
        {pending.map(renderItem)}
      </Box>
      <Footer total={checks.length} counts={statusCounts(checks)} />
    </Box>
  );
};
