import { MAX_WIDTH } from '../../../primitives/ScreenContainer.js';

/** Terminal rows used by chrome outside the viewer
 *  (TitleBar, spacer, screen padding, status bar, tab bar). */
export const CHROME_ROWS = 10;

/** Rows used by the viewer's own header / footer
 *  (title, divider, column headers, scroll-up marker, scroll-down marker,
 *  legend, "more checks…" tagline). The "Working on…" banner adds one more. */
export const VIEWER_CHROME_BASE = 7;

export const COL_AREA_WIDTH = 18;
export const COL_LABEL_MIN = 28;
export const COL_FILE_MIN = 24;
export const COL_GAP = 2;

export interface ViewerLayout {
  cols: number;
  visibleHeight: number;
  viewerChrome: number;
  padding: number;
  statusWidth: number;
  areaWidth: number;
  labelWidth: number;
  fileWidth: number;
  colGap: number;
  dividerWidth: number;
  detailIndent: number;
  detailWidth: number;
}

/** ScreenContainer wraps content in paddingX={1} inside a width capped at
 *  MAX_WIDTH, so the actual width available to the viewer is
 *  min(cols, MAX_WIDTH) - 2. */
function getViewerWidth(rawCols: number): number {
  return Math.min(MAX_WIDTH, rawCols) - 2;
}

export function computeLayout(
  rawCols: number,
  termRows: number,
  hasActiveTask: boolean,
): ViewerLayout {
  const cols = getViewerWidth(rawCols);
  const padding = 2;
  const statusWidth = 2;
  const fileWidth = COL_FILE_MIN;

  // FILE is fixed at its minimum width; CHECK flexes to consume the rest of
  // the row so long labels stay readable instead of getting truncated.
  const fixedExceptLabel =
    padding +
    statusWidth +
    COL_GAP +
    COL_AREA_WIDTH +
    COL_GAP +
    fileWidth +
    COL_GAP;
  const labelWidth = Math.max(COL_LABEL_MIN, cols - fixedExceptLabel - COL_GAP);

  const detailIndent = statusWidth + COL_GAP + COL_AREA_WIDTH + COL_GAP;

  const viewerChrome = VIEWER_CHROME_BASE + (hasActiveTask ? 1 : 0);
  const visibleHeight = Math.max(5, termRows - CHROME_ROWS - viewerChrome);

  return {
    cols,
    visibleHeight,
    viewerChrome,
    padding,
    statusWidth,
    areaWidth: COL_AREA_WIDTH,
    labelWidth,
    fileWidth,
    colGap: COL_GAP,
    dividerWidth: Math.max(20, cols - padding),
    detailIndent,
    detailWidth: Math.max(20, cols - detailIndent - padding),
  };
}

export function truncate(text: string, max: number): string {
  if (max <= 0) return '';
  if (text.length <= max) return text;
  return text.slice(0, Math.max(1, max - 1)) + '…';
}
