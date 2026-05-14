/**
 * Audit-3000 left pane on the Run screen. Arcade-flavoured fork of the
 * audit workflow's `PendingChecksList`: a running score banner sits on
 * top, then the standard grouped check ledger underneath.
 *
 * The grouped check rendering is intentionally near-identical to the
 * original so wide and narrow terminals behave the same; the arcade
 * dressing lives entirely in the `ScoreBanner` and group level labels.
 */

import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import {
  AUDIT_SEVERITY_STYLE,
  type AuditCheck,
  type AuditStatus,
} from '../../../../lib/workflows/audit/types.js';
import { Colors, Icons } from '../../styles.js';
import { LoadingBox } from '../../primitives/index.js';
import { useStdoutDimensions } from '../../hooks/useStdoutDimensions.js';

const COLLAPSE_BELOW_ROWS = 24;

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
        <Box marginRight={1}>
          <Spinner />
        </Box>
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

const CheckRow = ({ check }: { check: AuditCheck }) => {
  const { glyph, color } = AUDIT_SEVERITY_STYLE[check.status];
  return (
    <Text>
      <Text color={color}>{glyph}</Text>
      <Text dimColor={check.status === 'pending'}> {check.label}</Text>
    </Text>
  );
};

export const Audit3000ChecksPanel = ({ checks }: Audit3000ChecksPanelProps) => {
  const [, termRows] = useStdoutDimensions();

  if (checks.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold>AUDIT-3000</Text>
        <Text> </Text>
        <LoadingBox message="Booting up arcade cabinet..." />
      </Box>
    );
  }

  const groups = groupByArea(checks);
  const activeIndex = groups.findIndex((g) =>
    g.checks.some((c) => c.status === 'pending'),
  );
  const collapsed = termRows < COLLAPSE_BELOW_ROWS;

  return (
    <Box flexDirection="column">
      <Text bold color={NEON_PINK}>
        AUDIT-3000
      </Text>
      <Text> </Text>
      <ScoreBanner checks={checks} />
      {collapsed
        ? groups.map((group, i) => (
            <GroupHeader
              key={group.area}
              group={group}
              level={i + 1}
              showIcon
              isActive={i === activeIndex}
            />
          ))
        : groups.map((group, i) => (
            <Box
              key={group.area}
              flexDirection="column"
              marginTop={i === 0 ? 0 : 1}
            >
              <GroupHeader
                group={group}
                level={i + 1}
                showIcon={false}
                isActive={i === activeIndex}
              />
              {group.checks.map((c) => (
                <CheckRow key={c.id} check={c} />
              ))}
            </Box>
          ))}
    </Box>
  );
};
