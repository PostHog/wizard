import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStdoutDimensions } from '../../../ui/tui/hooks/useStdoutDimensions.js';
import { MAX_WIDTH } from '../../../ui/tui/primitives/ScreenContainer.js';
import {
  useKeyBindings,
  KeyMatch,
} from '../../../ui/tui/hooks/useKeyBindings.js';
import type { AuditCheck, AuditStatus } from './types.js';

type AuditTaskStatus = 'pending' | 'in_progress' | 'completed';

interface AuditTaskItem {
  label: string;
  activeForm?: string;
  status: AuditTaskStatus;
}

interface AuditChecksViewerProps {
  checks: AuditCheck[];
  tasks: ReadonlyArray<AuditTaskItem>;
}

const Legend = () => (
  <Text>
    <Text color="green">✔ pass</Text>
    <Text dimColor>{'   ·   '}</Text>
    <Text color="red">✘ error</Text>
    <Text dimColor>{'   ·   '}</Text>
    <Text color="yellow">⚠ warning</Text>
    <Text dimColor>{'   ·   '}</Text>
    <Text color="cyan">• suggestion</Text>
  </Text>
);

interface SeverityStyle {
  glyph: string;
  color: string;
}

const STYLE: Record<AuditStatus, SeverityStyle> = {
  pending: { glyph: '◌', color: 'gray' },
  pass: { glyph: '✔', color: 'green' },
  error: { glyph: '✘', color: 'red' },
  warning: { glyph: '⚠', color: 'yellow' },
  suggestion: { glyph: '•', color: 'cyan' },
};

/** Terminal rows used by chrome outside this component
 *  (TitleBar, spacer, screen padding, status bar, tab bar). */
const CHROME_ROWS = 10;
/** Rows used by this component's own header / footer
 *  (title, divider, column headers, scroll-up marker, scroll-down marker,
 *  legend, "more checks…" tagline). The "Working on…" banner adds one
 *  more row when present. */
const VIEWER_CHROME_BASE = 7;

const COL_AREA_WIDTH = 18;
const COL_LABEL_MIN = 28;
const COL_FILE_MIN = 24;
const COL_GAP = 2;

/** ScreenContainer wraps content in paddingX={1} inside a width capped at MAX_WIDTH,
 *  so the actual width available to this viewer is min(cols, MAX_WIDTH) - 2. */
function getViewerWidth(cols: number): number {
  return Math.min(MAX_WIDTH, cols) - 2;
}

function truncate(text: string, max: number): string {
  if (max <= 0) return '';
  if (text.length <= max) return text;
  return text.slice(0, Math.max(1, max - 1)) + '…';
}

function counts(checks: AuditCheck[]): Record<AuditStatus, number> {
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

export const AuditChecksViewer = ({
  checks,
  tasks,
}: AuditChecksViewerProps) => {
  // First in-progress task, else first pending — drives the "Working on…" banner.
  const activeTask =
    tasks.find((t) => t.status === 'in_progress') ??
    tasks.find((t) => t.status === 'pending');
  const [rawCols, termRows] = useStdoutDimensions();
  const cols = getViewerWidth(rawCols);
  const viewerChrome = VIEWER_CHROME_BASE + (activeTask ? 1 : 0);
  const visibleHeight = Math.max(5, termRows - CHROME_ROWS - viewerChrome);

  // Pending at the top, resolved below by severity, then by area.
  const sorted = useMemo(() => {
    const order: Record<AuditStatus, number> = {
      pending: 0,
      error: 1,
      warning: 2,
      suggestion: 3,
      pass: 4,
    };
    return [...checks].sort((a, b) => {
      const da = order[a.status] - order[b.status];
      if (da !== 0) return da;
      return a.area.localeCompare(b.area);
    });
  }, [checks]);

  const total = checks.length;
  const c = counts(checks);

  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState(false);
  // Sticky-to-top: the viewport tracks offset 0 until the user scrolls down.
  const stickyRef = useRef(true);

  type RenderRow =
    | { kind: 'item'; item: AuditCheck }
    | { kind: 'detail'; item: AuditCheck }
    | { kind: 'separator' }
    | { kind: 'section'; label: 'Up next' | 'Complete' };
  const rows = useMemo<RenderRow[]>(() => {
    const pending = sorted.filter((it) => it.status === 'pending');
    const done = sorted.filter((it) => it.status !== 'pending');
    const out: RenderRow[] = [];
    const pushItem = (item: AuditCheck) => {
      out.push({ kind: 'item', item });
      if (expanded && item.details) out.push({ kind: 'detail', item });
    };
    out.push({ kind: 'section', label: 'Up next' });
    for (const it of pending) pushItem(it);
    out.push({ kind: 'separator' }, { kind: 'separator' });
    out.push({ kind: 'section', label: 'Complete' });
    for (const it of done) pushItem(it);
    return out;
  }, [sorted, expanded]);

  const hasExpandable = useMemo(
    () => sorted.some((c) => Boolean(c.details)),
    [sorted],
  );

  const maxOffset = Math.max(0, rows.length - visibleHeight);

  useEffect(() => {
    if (stickyRef.current) {
      setOffset(0);
    } else if (offset > maxOffset) {
      setOffset(maxOffset);
    }
  }, [maxOffset, offset]);

  useKeyBindings('audit-checks-viewer', [
    {
      match: [KeyMatch.UpArrow, KeyMatch.DownArrow],
      label: '↑↓',
      action: 'scroll',
      handler: (_input, key) => {
        if (key.upArrow) {
          setOffset((prev) => {
            const next = Math.max(0, prev - 1);
            stickyRef.current = next === 0;
            return next;
          });
        }
        if (key.downArrow) {
          stickyRef.current = false;
          setOffset((prev) => Math.min(maxOffset, prev + 1));
        }
      },
    },
    {
      match: 'u',
      label: 'u',
      action: 'page up',
      handler: () => {
        setOffset((prev) => {
          const next = Math.max(0, prev - visibleHeight);
          stickyRef.current = next === 0;
          return next;
        });
      },
    },
    {
      match: 'd',
      label: 'd',
      action: 'page down',
      handler: () => {
        stickyRef.current = false;
        setOffset((prev) => Math.min(maxOffset, prev + visibleHeight));
      },
    },
    ...(hasExpandable
      ? [
          {
            match: 'e' as const,
            label: 'e',
            action: expanded ? 'collapse details' : 'expand details',
            handler: () => setExpanded((prev) => !prev),
          },
        ]
      : []),
  ]);

  const padding = 2;
  const statusWidth = 2;
  // FILE is fixed at its minimum width; CHECK flexes to consume the rest of
  // the row so long labels stay readable instead of getting truncated.
  const fileWidth = COL_FILE_MIN;
  const fixedExceptLabel =
    padding +
    statusWidth +
    COL_GAP +
    COL_AREA_WIDTH +
    COL_GAP +
    fileWidth +
    COL_GAP;
  const labelWidth = Math.max(COL_LABEL_MIN, cols - fixedExceptLabel - COL_GAP);

  if (total === 0) {
    const emptyBlockWidth = Math.min(64, Math.max(40, cols - 4));
    return (
      <Box
        flexDirection="column"
        paddingX={1}
        height={visibleHeight + viewerChrome}
        justifyContent="center"
        alignItems="center"
      >
        <Box flexDirection="column" width={emptyBlockWidth}>
          <Box gap={1}>
            <Spinner />
            <Text bold>Preparing audit</Text>
          </Box>
          <Box height={2} />
          <Text dimColor>The agent is gathering checks for this project.</Text>
          <Box height={1} />
          <Text dimColor>
            Each check appears here the moment it's queued, then resolves to:
          </Text>
          <Box height={1} />
          <Legend />
          <Box height={2} />
          <Text dimColor>Your integration will be checked in this order:</Text>
          <Box height={1} />
          <Text dimColor>Installation → Identification → Capture → Report</Text>
        </Box>
      </Box>
    );
  }

  const visibleRows = rows.slice(offset, offset + visibleHeight);
  const hiddenAbove = offset;
  const hiddenBelow = Math.max(0, rows.length - offset - visibleHeight);

  const dividerWidth = Math.max(20, cols - padding);
  const divider = '─'.repeat(dividerWidth);

  return (
    <Box
      flexDirection="column"
      paddingX={1}
      height={visibleHeight + viewerChrome}
    >
      {activeTask && (
        <Box gap={1}>
          <Spinner />
          <Text>
            <Text dimColor>Working on </Text>
            <Text bold>{activeTask.activeForm ?? activeTask.label}</Text>
          </Text>
        </Box>
      )}
      <Text bold>
        Up next{' '}
        <Text dimColor>
          ({total} total · {c.pending} pending · {c.error} errors · {c.warning}{' '}
          warnings · {c.suggestion} suggestions · {c.pass} passes)
        </Text>
      </Text>
      <Text dimColor>{divider}</Text>
      <Box>
        <Box width={statusWidth + COL_GAP}>
          <Text dimColor bold>
            {' '}
          </Text>
        </Box>
        <Box width={COL_AREA_WIDTH + COL_GAP}>
          <Text dimColor bold>
            AREA
          </Text>
        </Box>
        <Box width={labelWidth + COL_GAP}>
          <Text dimColor bold>
            CHECK
          </Text>
        </Box>
        <Box width={fileWidth}>
          <Text dimColor bold>
            FILE
          </Text>
        </Box>
      </Box>
      <Text dimColor>{hiddenAbove > 0 ? `↑ ${hiddenAbove} more` : ' '}</Text>
      <Box flexDirection="column" height={visibleHeight} overflow="hidden">
        {visibleRows.map((row, i) => {
          const key = `${offset + i}`;
          if (row.kind === 'separator') {
            return (
              <Box key={key} flexShrink={0}>
                <Text> </Text>
              </Box>
            );
          }
          if (row.kind === 'section') {
            return (
              <Box key={`${key}-section-${row.label}`} flexShrink={0}>
                <Text bold color="cyan">
                  {row.label}
                </Text>
              </Box>
            );
          }
          if (row.kind === 'detail') {
            // Indent under the CHECK column; wrap continuation aligns with the prefix.
            const indent = statusWidth + COL_GAP + COL_AREA_WIDTH + COL_GAP;
            const detailWidth = Math.max(20, cols - indent - padding);
            return (
              <Box key={`${key}-detail-${row.item.id}`} flexShrink={0}>
                <Box width={indent} />
                <Box width={detailWidth}>
                  <Text dimColor italic wrap="wrap">
                    {`↳ ${row.item.details ?? ''}`}
                  </Text>
                </Box>
              </Box>
            );
          }
          const item = row.item;
          const style = STYLE[item.status];
          return (
            <Box key={`${key}-${item.id}`} flexShrink={0}>
              <Box width={statusWidth + COL_GAP}>
                <Text color={style.color}>{style.glyph}</Text>
              </Box>
              <Box width={COL_AREA_WIDTH + COL_GAP}>
                <Text dimColor>{truncate(item.area, COL_AREA_WIDTH)}</Text>
              </Box>
              <Box width={labelWidth + COL_GAP}>
                <Text
                  bold={item.status !== 'pending'}
                  dimColor={item.status === 'pending'}
                >
                  {truncate(item.label, labelWidth)}
                </Text>
              </Box>
              <Box width={fileWidth}>
                <Text dimColor>{truncate(item.file ?? '', fileWidth - 1)}</Text>
              </Box>
            </Box>
          );
        })}
      </Box>
      <Text dimColor>{hiddenBelow > 0 ? `↓ ${hiddenBelow} more` : ' '}</Text>
      <Legend />
      <Text dimColor italic>
        more checks will be added as your project is explored
      </Text>
    </Box>
  );
};
