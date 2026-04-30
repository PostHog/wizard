import { Box, Text } from 'ink';
import type { AuditCheck } from '../../../../lib/workflows/audit/types.js';
import { Colors, Icons } from '../../styles.js';
import { LoadingBox } from '../../primitives/index.js';
import { useStdoutDimensions } from '../../hooks/useStdoutDimensions.js';

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
}: {
  group: Group;
  showIcon: boolean;
}) => {
  const complete = group.checks.filter((c) => c.status !== 'pending').length;
  const total = group.checks.length;
  const { icon, color } = groupIcon(group);
  return (
    <Text>
      {showIcon && (
        <Text>
          <Text color={color}>{icon}</Text>{' '}
        </Text>
      )}
      <Text bold>{group.area}</Text>{' '}
      <Text dimColor>
        ({complete}/{total})
      </Text>
    </Text>
  );
};

const CheckRow = ({ check }: { check: AuditCheck }) => {
  const icon =
    check.status === 'pending' ? Icons.squareOpen : Icons.squareFilled;
  const color = check.status === 'pending' ? Colors.muted : Colors.success;
  return (
    <Text>
      <Text color={color}>{icon}</Text>
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
  const collapsed = termRows < COLLAPSE_BELOW_ROWS;

  return (
    <Box flexDirection="column">
      <Text bold>Checks</Text>
      <Text> </Text>
      {collapsed
        ? groups.map((group) => (
            <GroupHeader key={group.area} group={group} showIcon />
          ))
        : groups.map((group, i) => (
            <Box
              key={group.area}
              flexDirection="column"
              marginTop={i === 0 ? 0 : 1}
            >
              <GroupHeader group={group} showIcon={false} />
              {group.checks.map((c) => (
                <CheckRow key={c.id} check={c} />
              ))}
            </Box>
          ))}
    </Box>
  );
};
