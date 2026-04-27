import { Box, Text } from 'ink';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStdoutDimensions } from '../../../ui/tui/hooks/useStdoutDimensions.js';
import { MAX_WIDTH } from '../../../ui/tui/primitives/ScreenContainer.js';
import {
  useKeyBindings,
  KeyMatch,
} from '../../../ui/tui/hooks/useKeyBindings.js';
import type { AuditCheck, AuditStatus } from './types.js';

interface AuditChecksViewerProps {
  checks: AuditCheck[];
}

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
/** Rows used by this component's own header / footer (title + blank + divider + blank + columns + blank + scroll markers). */
const VIEWER_CHROME = 8;

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

export const AuditChecksViewer = ({ checks }: AuditChecksViewerProps) => {
  const [rawCols, rows] = useStdoutDimensions();
  const cols = getViewerWidth(rawCols);
  const visibleHeight = Math.max(5, rows - CHROME_ROWS - VIEWER_CHROME);

  // Sort: pending last (so completed items stay grouped at top), then
  // by area to keep phases visually adjacent.
  const sorted = useMemo(() => {
    const order: Record<AuditStatus, number> = {
      error: 0,
      warning: 1,
      suggestion: 2,
      pass: 3,
      pending: 4,
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
  const stickyRef = useRef(true);

  const maxOffset = Math.max(0, sorted.length - visibleHeight);

  useEffect(() => {
    if (stickyRef.current) {
      setOffset(maxOffset);
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
          stickyRef.current = false;
          setOffset((prev) => Math.max(0, prev - 1));
        }
        if (key.downArrow) {
          setOffset((prev) => {
            const next = Math.min(maxOffset, prev + 1);
            stickyRef.current = next >= maxOffset;
            return next;
          });
        }
      },
    },
    {
      match: 'u',
      label: 'u',
      action: 'page up',
      handler: () => {
        stickyRef.current = false;
        setOffset((prev) => Math.max(0, prev - visibleHeight));
      },
    },
    {
      match: 'd',
      label: 'd',
      action: 'page down',
      handler: () => {
        setOffset((prev) => {
          const next = Math.min(maxOffset, prev + visibleHeight);
          stickyRef.current = next >= maxOffset;
          return next;
        });
      },
    },
  ]);

  const padding = 2;
  const statusWidth = 2;
  const fixedExceptFile =
    padding +
    statusWidth +
    COL_GAP +
    COL_AREA_WIDTH +
    COL_GAP +
    COL_LABEL_MIN +
    COL_GAP;
  const fileWidth = Math.max(COL_FILE_MIN, cols - fixedExceptFile - COL_GAP);

  if (total === 0) {
    return (
      <Box
        flexDirection="column"
        paddingX={1}
        height={visibleHeight + VIEWER_CHROME}
      >
        <Text bold>Audit checks</Text>
        <Box height={1} />
        <Text dimColor>
          Waiting for the agent to record checks. Items appear here as each
          phase progresses (Installation → Identification → Capture).
        </Text>
      </Box>
    );
  }

  const visible = sorted.slice(offset, offset + visibleHeight);
  const hiddenAbove = offset;
  const hiddenBelow = Math.max(0, sorted.length - offset - visibleHeight);

  const dividerWidth = Math.max(20, cols - padding);
  const divider = '─'.repeat(dividerWidth);

  return (
    <Box
      flexDirection="column"
      paddingX={1}
      height={visibleHeight + VIEWER_CHROME}
    >
      <Text bold>
        Audit checks{' '}
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
        <Box width={COL_LABEL_MIN + COL_GAP}>
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
        {visible.map((item, i) => {
          const style = STYLE[item.status];
          return (
            <Box key={`${offset + i}-${item.id}`} flexShrink={0}>
              <Box width={statusWidth + COL_GAP}>
                <Text color={style.color}>{style.glyph}</Text>
              </Box>
              <Box width={COL_AREA_WIDTH + COL_GAP}>
                <Text dimColor>{truncate(item.area, COL_AREA_WIDTH)}</Text>
              </Box>
              <Box width={COL_LABEL_MIN + COL_GAP}>
                <Text
                  bold={item.status !== 'pending'}
                  dimColor={item.status === 'pending'}
                >
                  {truncate(item.label, COL_LABEL_MIN)}
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
    </Box>
  );
};
