import { MAX_WIDTH } from '../../../primitives/ScreenContainer.js';

/** Terminal rows used by chrome outside the viewer
 *  (TitleBar, spacer, screen padding, status bar, tab bar). */
export const CHROME_ROWS = 10;

/** Rows used by the viewer's own header / footer
 *  (title, subtitle, top summary, spacer, column headers, divider,
 *  scroll-up marker, scroll-down marker, legend, footer summary). */
export const VIEWER_CHROME_BASE = 10;

export const COL_AREA_WIDTH = 18;
export const COL_LABEL_MIN = 28;
export const COL_GAP = 2;

export interface ViewerLayout {
  cols: number;
  visibleHeight: number;
  viewerChrome: number;
  padding: number;
  statusWidth: number;
  areaWidth: number;
  labelWidth: number;
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

export function computeLayout(rawCols: number, termRows: number): ViewerLayout {
  const cols = getViewerWidth(rawCols);
  const padding = 2;
  const statusWidth = 2;

  // CHECK flexes to consume the rest of the row so long labels stay readable
  // instead of getting truncated.
  const fixedExceptLabel =
    padding + statusWidth + COL_GAP + COL_AREA_WIDTH + COL_GAP + COL_GAP;
  const labelWidth = Math.max(COL_LABEL_MIN, cols - fixedExceptLabel);

  const detailIndent = statusWidth + COL_GAP + COL_AREA_WIDTH + COL_GAP;

  const viewerChrome = VIEWER_CHROME_BASE;
  const visibleHeight = Math.max(5, termRows - CHROME_ROWS - viewerChrome);

  return {
    cols,
    visibleHeight,
    viewerChrome,
    padding,
    statusWidth,
    areaWidth: COL_AREA_WIDTH,
    labelWidth,
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
