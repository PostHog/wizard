import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import {
  AUDIT_SEVERITY_STYLE,
  type AuditCheck,
} from '@lib/programs/audit/types';
import { Colors, Icons } from '@ui/tui/styles';
import { LoadingBox } from '@ui/tui/primitives/index';
import { useStdoutDimensions } from '@ui/tui/hooks/useStdoutDimensions';

interface PendingChecksListProps {
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
  showIcon,
  isActive,
}: {
  group: Group;
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

const COLLAPSE_BELOW_ROWS = 24;

export const PendingChecksList = ({ checks }: PendingChecksListProps) => {
  const [, termRows] = useStdoutDimensions();

  if (checks.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold>Checks</Text>
        <Text> </Text>
        <LoadingBox message="Seeding audit checklist..." />
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
      <Text bold>Checks</Text>
      <Text> </Text>
      {collapsed
        ? groups.map((group, i) => (
            <GroupHeader
              key={group.area}
              group={group}
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
