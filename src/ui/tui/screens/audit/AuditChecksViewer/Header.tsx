import { Box, Text } from 'ink';
import type {
  AuditCheck,
  AuditStatus,
} from '@lib/programs/audit/types';
import type { ViewerLayout } from './layout.js';

interface HeaderProps {
  layout: ViewerLayout;
}

interface SummaryProps {
  total: number;
  counts: Record<AuditStatus, number>;
}

function statusCounts(checks: AuditCheck[]): Record<AuditStatus, number> {
  const out: Record<AuditStatus, number> = {
    pending: 0,
    pass: 0,
    error: 0,
    warning: 0,
    suggestion: 0,
  };
  for (const c of checks) out[c.status] += 1;
  return out;
}

export { statusCounts };

export const Header = ({ layout }: HeaderProps) => (
  <Box>
    <Box width={layout.statusWidth + layout.colGap}>
      <Text dimColor bold>
        {' '}
      </Text>
    </Box>
    <Box width={layout.areaWidth + layout.colGap}>
      <Text dimColor bold>
        AREA
      </Text>
    </Box>
    <Box width={layout.labelWidth + layout.colGap}>
      <Text dimColor bold>
        CHECK
      </Text>
    </Box>
  </Box>
);

export const Summary = ({ total, counts }: SummaryProps) => (
  <Text dimColor>
    {total} total · {counts.pending} pending · {counts.error} errors ·{' '}
    {counts.warning} warnings · {counts.suggestion} suggestions · {counts.pass}{' '}
    passes
  </Text>
);
