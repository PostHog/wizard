import { Fragment } from 'react';
import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import {
  AUDIT_SEVERITY_STYLE,
  type AuditCheck,
} from '@lib/programs/audit/types';
import {
  LANE_BY_AREA,
  LANE_LABEL,
  LANE_ORDER,
  type CullLane,
} from '@lib/programs/cull-feature-flags/classify';
import type { CullProgress } from '@lib/programs/cull-feature-flags/phase';
import {
  CULLED_MARKER,
  DECLINED_MARKER,
} from '@lib/programs/cull-feature-flags/seed';
import { useStdoutDimensions } from '@ui/tui/hooks/useStdoutDimensions';
import { LoadingBox } from '@ui/tui/primitives/index';
import { Colors, Icons } from '@ui/tui/styles';
import type { CullPhase } from '../slides/cull/phase.js';

export type LaneRowState =
  | 'pending'
  | 'proposed'
  | 'kept'
  | 'editing'
  | 'edited'
  | 'disabling'
  | 'culled'
  | 'failed'
  | 'declined';

export interface LaneRow {
  id: string;
  glyph: string;
  color: string;
  text: string;
  state: LaneRowState;
}

export interface LaneGroup {
  lane: CullLane;
  label: string;
  rows: LaneRow[];
  hiddenCount: number;
  footer?: string;
  complete: number;
  total: number;
}

interface MutableLaneGroup {
  rows: LaneRow[];
  complete: number;
  total: number;
  declinedCount: number;
}

interface FoldedCounts {
  healthy: number;
  kept: number;
  suggestions: number;
}

interface CullFlagListProps {
  checks: readonly AuditCheck[];
  progress: CullProgress;
  phase: CullPhase;
}

const MAX_VISIBLE_ROWS = 5;
const COLLAPSE_BELOW_ROWS = 30;
const KEPT_MARKER = '; kept:';
const FAILED_MARKER = '; failed:';

const PHASE_STEPS: ReadonlyArray<{ phase: CullPhase; label: string }> = [
  { phase: 'verify', label: 'Verify' },
  { phase: 'pick', label: 'Pick' },
  { phase: 'cull', label: 'Cull' },
  { phase: 'report', label: 'Report' },
];

function hasMarker(check: AuditCheck, marker: string): boolean {
  return (check.details ?? '').includes(marker);
}

function markerReason(details: string, marker: string): string {
  const markerIndex = details.indexOf(marker);
  if (markerIndex < 0) return '';
  return details
    .slice(markerIndex + marker.length)
    .split(';')[0]
    .trim();
}

function rowReason(check: AuditCheck): string {
  const details = check.details ?? '';
  if (hasMarker(check, KEPT_MARKER)) {
    return markerReason(details, KEPT_MARKER);
  }
  if (hasMarker(check, FAILED_MARKER)) {
    return markerReason(details, FAILED_MARKER);
  }
  return details.split(';')[0].trim();
}

function baseRowState(check: AuditCheck): LaneRowState {
  if (hasMarker(check, CULLED_MARKER)) return 'culled';
  if (check.status === 'error' || hasMarker(check, FAILED_MARKER)) {
    return 'failed';
  }
  if (hasMarker(check, DECLINED_MARKER)) return 'declined';
  if (hasMarker(check, KEPT_MARKER)) return 'kept';
  if (check.status === 'warning') return 'proposed';
  return 'pending';
}

function rowState(
  check: AuditCheck,
  progress: CullProgress,
  phase: CullPhase,
): LaneRowState {
  const state = baseRowState(check);
  if (state === 'culled' || state === 'failed' || state === 'declined') {
    return state;
  }
  if (phase !== 'cull') return state;
  if (check.id === progress.activeKey && progress.pass === 'edit') {
    return 'editing';
  }
  if (check.id === progress.activeKey && progress.pass === 'disable') {
    return 'disabling';
  }
  if (progress.edited.includes(check.id)) return 'edited';
  return state;
}

function stateReason(state: LaneRowState, check: AuditCheck): string {
  if (state === 'editing') return 'editing';
  if (state === 'edited') return 'edited';
  if (state === 'disabling') return 'disabling';
  if (state === 'culled') return 'culled';
  return rowReason(check);
}

function toLaneRow(
  check: AuditCheck,
  progress: CullProgress,
  phase: CullPhase,
): LaneRow {
  const state = rowState(check, progress, phase);
  const { glyph, color } = AUDIT_SEVERITY_STYLE[check.status];
  return {
    id: check.id,
    glyph,
    color,
    text: `${check.id}  ${stateReason(state, check)}`,
    state,
  };
}

function isCompleteState(state: LaneRowState): boolean {
  return ['kept', 'edited', 'culled', 'failed', 'declined'].includes(state);
}

function isHealthy(check: AuditCheck): boolean {
  if (check.status !== 'pass') return false;
  return ![KEPT_MARKER, CULLED_MARKER, DECLINED_MARKER].some((marker) =>
    hasMarker(check, marker),
  );
}

function shouldShowInVerify(check: AuditCheck): boolean {
  if (hasMarker(check, KEPT_MARKER)) return true;
  return check.status === 'pending' || check.status === 'warning';
}

function shouldShowInCull(check: AuditCheck): boolean {
  if (hasMarker(check, CULLED_MARKER)) return true;
  if (check.status === 'error') return true;
  return check.status === 'warning';
}

function foldedFooter(counts: FoldedCounts): string | undefined {
  const parts = [
    counts.healthy > 0 ? `${counts.healthy} healthy` : null,
    counts.kept > 0 ? `${counts.kept} kept` : null,
    counts.suggestions > 0
      ? `${counts.suggestions} suggestion${counts.suggestions === 1 ? '' : 's'}`
      : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return undefined;
  return `${parts.join(', ')}, nothing to do`;
}

export function toLaneGroups(
  checks: readonly AuditCheck[],
  progress: CullProgress,
  phase: CullPhase,
): LaneGroup[] {
  const groupsByLane: Record<CullLane, MutableLaneGroup> = {
    decided: { rows: [], complete: 0, total: 0, declinedCount: 0 },
    'off-in-posthog': { rows: [], complete: 0, total: 0, declinedCount: 0 },
    'not-in-code': { rows: [], complete: 0, total: 0, declinedCount: 0 },
    'nothing-to-cull': {
      rows: [],
      complete: 0,
      total: 0,
      declinedCount: 0,
    },
  };
  const foldedCounts: FoldedCounts = {
    healthy: 0,
    kept: 0,
    suggestions: 0,
  };
  const isVerifyOrPick = phase === 'verify' || phase === 'pick';

  for (const check of checks) {
    const sourceLane = LANE_BY_AREA[check.area] ?? 'nothing-to-cull';
    const isSuggestion = check.area === 'Many call sites';
    const isApprovedSuggestion =
      !isVerifyOrPick &&
      (hasMarker(check, CULLED_MARKER) || check.status === 'error');
    if (isSuggestion && !isApprovedSuggestion) {
      foldedCounts.suggestions += 1;
      continue;
    }
    if (isVerifyOrPick && isHealthy(check)) {
      foldedCounts.healthy += 1;
      continue;
    }
    if (!isVerifyOrPick && hasMarker(check, DECLINED_MARKER)) {
      const group = groupsByLane[sourceLane];
      group.declinedCount += 1;
      group.complete += 1;
      group.total += 1;
      continue;
    }
    if (!isVerifyOrPick && hasMarker(check, KEPT_MARKER)) {
      foldedCounts.kept += 1;
      continue;
    }
    if (!isVerifyOrPick && isHealthy(check)) {
      foldedCounts.healthy += 1;
      continue;
    }

    const shouldShow = isVerifyOrPick
      ? shouldShowInVerify(check)
      : shouldShowInCull(check);
    if (!shouldShow) continue;
    const group = groupsByLane[sourceLane];
    const row = toLaneRow(check, progress, phase);
    group.rows.push(row);
    group.total += 1;
    if (isCompleteState(row.state)) group.complete += 1;
  }

  const nothingToCullFooter = foldedFooter(foldedCounts);
  return LANE_ORDER.map((lane): LaneGroup | null => {
    const group = groupsByLane[lane];
    const hiddenCount = Math.max(0, group.rows.length - MAX_VISIBLE_ROWS);
    const declinedFooter =
      group.declinedCount > 0
        ? `${group.declinedCount} left for you`
        : undefined;
    const footer =
      lane === 'nothing-to-cull' ? nothingToCullFooter : declinedFooter;
    if (group.rows.length === 0 && !footer) return null;
    return {
      lane,
      label: LANE_LABEL[lane],
      rows: group.rows.slice(0, MAX_VISIBLE_ROWS),
      hiddenCount,
      footer,
      complete: group.complete,
      total: group.total,
    };
  }).filter((group): group is LaneGroup => group !== null);
}

function groupIcon(group: LaneGroup): { icon: string; color: string } {
  if (group.complete === 0) {
    return { icon: Icons.squareOpen, color: Colors.muted };
  }
  if (group.complete === group.total) {
    return { icon: Icons.squareFilled, color: Colors.success };
  }
  return { icon: Icons.triangleRight, color: Colors.primary };
}

const LaneHeader = ({
  group,
  isActive,
}: {
  group: LaneGroup;
  isActive: boolean;
}) => {
  const { icon, color } = groupIcon(group);
  return (
    <Box>
      {isActive ? (
        <Box marginRight={1}>
          <Spinner />
        </Box>
      ) : (
        <Text>
          <Text color={color}>{icon}</Text>{' '}
        </Text>
      )}
      <Text>
        <Text bold>{group.label}</Text>{' '}
        {group.lane !== 'nothing-to-cull' && (
          <Text dimColor>
            ({group.complete}/{group.total})
          </Text>
        )}
      </Text>
    </Box>
  );
};

const FlagRow = ({ row }: { row: LaneRow }) => {
  if (row.state === 'editing' || row.state === 'disabling') {
    return (
      <Box>
        <Box marginRight={1}>
          <Spinner />
        </Box>
        <Text wrap="truncate-end">{row.text}</Text>
      </Box>
    );
  }
  return (
    <Text wrap="truncate-end">
      <Text color={row.color}>{row.glyph}</Text> {row.text}
    </Text>
  );
};

function activeLaneFor(
  checks: readonly AuditCheck[],
  progress: CullProgress,
  phase: CullPhase,
): CullLane | undefined {
  if (phase === 'verify') {
    const firstPending = checks.find(
      (check) => check.status === 'pending' && check.area !== 'Many call sites',
    );
    if (!firstPending) return undefined;
    return LANE_BY_AREA[firstPending.area] ?? 'nothing-to-cull';
  }
  if (phase !== 'cull' || !progress.activeKey) return undefined;
  const activeCheck = checks.find((check) => check.id === progress.activeKey);
  if (!activeCheck) return undefined;
  return LANE_BY_AREA[activeCheck.area] ?? 'nothing-to-cull';
}

export const PhaseStepper = ({ phase }: { phase: CullPhase }) => {
  const currentIndex = PHASE_STEPS.findIndex((step) => step.phase === phase);
  return (
    <Box paddingX={1} marginBottom={1}>
      {PHASE_STEPS.map((step, index) => (
        <Fragment key={step.phase}>
          {index > 0 && <Text color={Colors.muted}> ─ </Text>}
          {index < currentIndex ? (
            <Text dimColor>
              {Icons.check} {step.label}
            </Text>
          ) : null}
          {index === currentIndex ? (
            <Text bold color={Colors.accent}>
              {step.label}
            </Text>
          ) : null}
          {index > currentIndex ? (
            <Text color={Colors.muted}>{step.label}</Text>
          ) : null}
        </Fragment>
      ))}
    </Box>
  );
};

export const CullFlagList = ({
  checks,
  progress,
  phase,
}: CullFlagListProps) => {
  const [, terminalRows] = useStdoutDimensions();
  if (checks.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold>Flags</Text>
        <Text> </Text>
        <LoadingBox message="Seeding audit checklist..." />
      </Box>
    );
  }

  const groups = toLaneGroups(checks, progress, phase);
  const activeLane = activeLaneFor(checks, progress, phase);
  const shouldCollapse = terminalRows < COLLAPSE_BELOW_ROWS;

  return (
    <Box flexDirection="column">
      <Text bold>Flags</Text>
      <Text> </Text>
      {groups.map((group, index) => {
        const isActive = group.lane === activeLane;
        const isExpanded = !shouldCollapse || isActive;
        const showsOnlyFooter =
          group.lane === 'nothing-to-cull' && group.rows.length === 0;
        if (showsOnlyFooter) {
          return (
            <Text key={group.lane} dimColor wrap="truncate-end">
              {group.footer}
            </Text>
          );
        }
        return (
          <Box
            key={group.lane}
            flexDirection="column"
            marginTop={index === 0 ? 0 : 1}
          >
            <LaneHeader group={group} isActive={isActive} />
            {isExpanded &&
              group.rows.map((row) => <FlagRow key={row.id} row={row} />)}
            {isExpanded && group.hiddenCount > 0 && (
              <Text dimColor wrap="truncate-end">
                +{group.hiddenCount} more
              </Text>
            )}
            {isExpanded && group.footer && (
              <Text dimColor wrap="truncate-end">
                {group.footer}
              </Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
};
