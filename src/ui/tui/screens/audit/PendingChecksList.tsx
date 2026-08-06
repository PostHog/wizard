import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import {
  AUDIT_SEVERITY_STYLE,
  type AuditCheck,
} from '@lib/programs/audit/types';
import { Colors, Icons } from '@ui/tui/styles';
import { LoadingBox } from '@ui/tui/primitives/index';
import { useStdoutDimensions } from '@ui/tui/hooks/useStdoutDimensions';
import { WIZARD_LOG_FILE } from '@utils/paths';

interface PendingChecksListProps {
  checks: AuditCheck[];
  /** Absolute ledger path, shown in the empty-state diagnostics. */
  ledgerPath?: string;
}

export interface Group {
  area: string;
  checks: AuditCheck[];
}

export function groupByArea(checks: AuditCheck[]): Group[] {
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
    <Box flexShrink={0}>
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
    <Box flexShrink={0}>
      <Text>
        <Text color={color}>{glyph}</Text>
        <Text dimColor={check.status === 'pending'}> {check.label}</Text>
      </Text>
    </Box>
  );
};

/** Rows the surrounding chrome (tab bar, borders, status bar) consumes. */
const CHROME_ROWS = 10;

const DIAGNOSTICS_AFTER_S = 10;
const QUIT_HINT_AFTER_S = 30;

/** Empty-ledger state with escalating diagnostics — never a bare spinner. */
const SeedingState = ({ ledgerPath }: { ledgerPath?: string }) => {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <Box flexDirection="column">
      <Text bold>Checks</Text>
      <Text> </Text>
      <LoadingBox message="Seeding audit checklist..." />
      {elapsed >= DIAGNOSTICS_AFTER_S && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>
            Still waiting for the checklist
            {ledgerPath ? ` at ${ledgerPath}` : ''}.
          </Text>
          <Text dimColor>Logs: {WIZARD_LOG_FILE}</Text>
        </Box>
      )}
      {elapsed >= QUIT_HINT_AFTER_S && (
        <Box marginTop={1}>
          <Text dimColor>
            This is taking longer than expected — press ctrl+c to quit, then
            re-run the command.
          </Text>
        </Box>
      )}
    </Box>
  );
};

/** How much of the list fits: everything, the active group expanded with the
 * rest as one-line headers, or headers only. */
export type Density = 'full' | 'active' | 'headers';

export function pickDensity(
  groups: Group[],
  activeIndex: number,
  termRows: number,
): Density {
  const available = termRows - CHROME_ROWS;
  const fullRows =
    2 +
    groups.reduce((rows, g) => rows + 1 + g.checks.length, 0) +
    (groups.length - 1);
  if (fullRows <= available) return 'full';
  const activeRows =
    2 +
    groups.length +
    (activeIndex >= 0 ? groups[activeIndex].checks.length : 0);
  if (activeRows <= available) return 'active';
  return 'headers';
}

export const PendingChecksList = ({
  checks,
  ledgerPath,
}: PendingChecksListProps) => {
  const [, termRows] = useStdoutDimensions();

  if (checks.length === 0) {
    return <SeedingState ledgerPath={ledgerPath} />;
  }

  const groups = groupByArea(checks);
  const activeIndex = groups.findIndex((g) =>
    g.checks.some((c) => c.status === 'pending'),
  );
  const density = pickDensity(groups, activeIndex, termRows);

  // flexShrink=0 throughout so overflow clips instead of squashing rows.
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Text bold>Checks</Text>
      <Text> </Text>
      {density === 'headers' &&
        groups.map((group, i) => (
          <GroupHeader
            key={group.area}
            group={group}
            showIcon
            isActive={i === activeIndex}
          />
        ))}
      {density === 'active' &&
        groups.map((group, i) => (
          <Box key={group.area} flexDirection="column" flexShrink={0}>
            <GroupHeader
              group={group}
              showIcon={i !== activeIndex}
              isActive={i === activeIndex}
            />
            {i === activeIndex &&
              group.checks.map((c) => <CheckRow key={c.id} check={c} />)}
          </Box>
        ))}
      {density === 'full' &&
        groups.map((group, i) => (
          <Box
            key={group.area}
            flexDirection="column"
            flexShrink={0}
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
