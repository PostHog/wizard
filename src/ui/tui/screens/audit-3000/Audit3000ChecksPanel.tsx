/**
 * Audit-3000 left pane on the Run screen. Arcade-flavoured fork of the
 * audit program's `PendingChecksList`: a running score banner sits on
 * top, then the area-level "level" headers underneath.
 *
 * Per-check rows are deliberately omitted here — the Hi-score Table tab
 * has the full check-by-check breakdown. This pane is the at-a-glance
 * stage overview.
 */

import { memo } from 'react';
import { Box, Text } from 'ink';
import { type AuditCheck, type AuditStatus } from '@lib/programs/audit/types';
import { Colors, Icons } from '@ui/tui/styles';
import { LoadingBox } from '@ui/tui/primitives/index';

const NEON_PINK = '#F54E00';
const NEON_GOLD = '#F9BD2B';
const NEON_BLUE = '#1D4AFF';

interface Audit3000ChecksPanelProps {
  checks: AuditCheck[];
}

interface Group {
  area: string;
  checks: AuditCheck[];
}

function groupByArea(checks: AuditCheck[]): Group[] {
  const order: string[] = [];
  const map = new Map<string, AuditCheck[]>();
  for (const c of checks) {
    if (!map.has(c.area)) {
      map.set(c.area, []);
      order.push(c.area);
    }
    map.get(c.area)!.push(c);
  }
  return order.map((area) => ({ area, checks: map.get(area)! }));
}

function countByStatus(checks: AuditCheck[]): Record<AuditStatus, number> {
  const counts: Record<AuditStatus, number> = {
    pending: 0,
    pass: 0,
    error: 0,
    warning: 0,
    suggestion: 0,
  };
  for (const c of checks) counts[c.status] += 1;
  return counts;
}

const ScoreBanner = ({ checks }: { checks: AuditCheck[] }) => {
  const counts = countByStatus(checks);
  const resolved = checks.length - counts.pending;
  const issues = counts.error + counts.warning + counts.suggestion;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        <Text bold color={NEON_PINK}>
          {'SCORE '}
        </Text>
        <Text bold color={NEON_GOLD}>
          {resolved.toString().padStart(2, '0')}
        </Text>
        <Text dimColor>{' / '}</Text>
        <Text bold>{checks.length.toString().padStart(2, '0')}</Text>
      </Text>
      <Text>
        <Text color="green">{`PASS \u25B2 ${counts.pass}`}</Text>
        <Text>{'   '}</Text>
        <Text color={NEON_PINK}>{`MISS \u25BC ${issues}`}</Text>
        <Text>{'   '}</Text>
        <Text dimColor>{`QUEUE \u25CB ${counts.pending}`}</Text>
      </Text>
    </Box>
  );
};

function groupIcon(group: Group): { icon: string; color: string } {
  const total = group.checks.length;
  const complete = group.checks.filter((c) => c.status !== 'pending').length;
  if (complete === 0) return { icon: Icons.squareOpen, color: Colors.muted };
  if (complete === total)
    return { icon: Icons.squareFilled, color: Colors.success };
  return { icon: Icons.triangleRight, color: Colors.primary };
}

const GroupHeader = ({
  group,
  level,
  showIcon,
  isActive,
}: {
  group: Group;
  level: number;
  showIcon: boolean;
  isActive: boolean;
}) => {
  const complete = group.checks.filter((c) => c.status !== 'pending').length;
  const total = group.checks.length;
  const { icon, color } = groupIcon(group);
  return (
    <Box>
      {isActive ? (
        <Text>
          <Text bold color={NEON_PINK}>
            {'\u25B6'}
          </Text>{' '}
        </Text>
      ) : showIcon ? (
        <Text>
          <Text color={color}>{icon}</Text>{' '}
        </Text>
      ) : null}
      <Text>
        <Text color={NEON_BLUE} bold>{`L${level} `}</Text>
        <Text bold>{group.area}</Text>{' '}
        <Text dimColor>
          ({complete}/{total})
        </Text>
      </Text>
    </Box>
  );
};

const Audit3000ChecksPanelImpl = ({ checks }: Audit3000ChecksPanelProps) => {
  if (checks.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold color={NEON_PINK}>
          AUDIT-3000
        </Text>
        <Text> </Text>
        <LoadingBox message="Booting up arcade cabinet..." />
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>
            Reviewing your PostHog integration across 34 checks. ~5\u20137 min.
          </Text>
          <Text dimColor> </Text>
          <Text dimColor>
            Use <Text color={NEON_GOLD}>{'\u2190 \u2192'}</Text> to switch tabs:
          </Text>
          <Text dimColor>
            {'  '}Arcade · Hi-score Table · Play · Tail logs · HN
          </Text>
          <Text dimColor> </Text>
          <Text dimColor>
            Output: a notebook in your PostHog project (link printed at the
            end).
          </Text>
        </Box>
      </Box>
    );
  }

  const groups = groupByArea(checks);
  const activeIndex = groups.findIndex((g) =>
    g.checks.some((c) => c.status === 'pending'),
  );

  return (
    <Box flexDirection="column">
      <Text bold color={NEON_PINK}>
        AUDIT-3000
      </Text>
      <Text> </Text>
      <ScoreBanner checks={checks} />
      {groups.map((group, i) => (
        <GroupHeader
          key={group.area}
          group={group}
          level={i + 1}
          showIcon
          isActive={i === activeIndex}
        />
      ))}
      <Box marginTop={1}>
        <Text dimColor>
          Full breakdown: <Text color={NEON_GOLD}>Hi-score table (report)</Text>{' '}
          tab
        </Text>
      </Box>
    </Box>
  );
};

/**
 * Memo'd to skip re-renders when the `checks` array reference is stable.
 * The parent `Audit3000RunScreen` subscribes to the whole wizard store
 * (status messages, file watcher events) and re-renders on every change;
 * without this memo, the right pane redraws on every spinner tick / status
 * line, which compounds Ink's frame-redraw flicker. Other workflows are
 * unaffected — this is audit-3000 only.
 */
export const Audit3000ChecksPanel = memo(
  Audit3000ChecksPanelImpl,
  (prev, next) => prev.checks === next.checks,
);
