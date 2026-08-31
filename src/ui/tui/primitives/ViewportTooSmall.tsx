/**
 * ViewportTooSmall — The nag shown when the terminal is smaller than the
 * wizard's layout can survive.
 *
 * 80 columns is the width `ScreenContainer` clamps its layout to. 28 rows is
 * measured, not chosen: the framework picker — the tallest screen — overprints
 * its intro lines and silently drops framework options at 27 rows and below,
 * and renders cleanly at 28 (issue #1111). Below either bound the wizard looks
 * broken rather than small, so say so instead of rendering.
 */

import { Box, Text } from 'ink';
import { wordWrap } from './layout-helpers.js';
import { Colors } from '@ui/tui/styles';

/** Smallest terminal the wizard will render its screens into. */
export const MIN_VIEWPORT_COLUMNS = 80;
export const MIN_VIEWPORT_ROWS = 28;

export const VIEWPORT_TOO_SMALL_MESSAGE =
  'Hey, can you make this terminal window a little bigger? The interactive Wizard needs more room to display properly.';

export function isViewportTooSmall(columns: number, rows: number): boolean {
  return columns < MIN_VIEWPORT_COLUMNS || rows < MIN_VIEWPORT_ROWS;
}

/**
 * Pre-wrap the notice rather than letting Ink wrap it: the whole point of this
 * screen is that it renders correctly in a terminal too narrow for everything
 * else. Accounts for the component's own paddingX={1}.
 */
export function viewportNoticeLines(text: string, columns: number): string[] {
  return wordWrap(text, Math.max(20, columns - 2));
}

/** The "you have this much, you need this much" line under the message. */
export function viewportSizeLine(columns: number, rows: number): string {
  return `Currently ${columns}×${rows}, needs at least ${MIN_VIEWPORT_COLUMNS}×${MIN_VIEWPORT_ROWS}.`;
}

interface ViewportTooSmallProps {
  columns: number;
  rows: number;
}

export const ViewportTooSmall = ({ columns, rows }: ViewportTooSmallProps) => {
  const message = viewportNoticeLines(VIEWPORT_TOO_SMALL_MESSAGE, columns);
  const size = viewportNoticeLines(viewportSizeLine(columns, rows), columns);

  return (
    <Box
      flexDirection="column"
      width={columns}
      height={rows}
      paddingX={1}
      justifyContent="center"
    >
      {message.map((line, i) => (
        <Text key={`m${i}`} color={Colors.error} bold>
          {line}
        </Text>
      ))}
      <Box height={1} />
      {size.map((line, i) => (
        <Text key={`s${i}`} color={Colors.muted}>
          {line}
        </Text>
      ))}
    </Box>
  );
};
