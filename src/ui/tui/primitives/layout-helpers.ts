/**
 * Layout helpers — pure functions for height estimation and viewport eviction.
 *
 * These are the core of the responsive content system. They estimate how many
 * terminal rows a content block will occupy and determine which blocks fit
 * within a given height budget.
 */

import type { ContentBlock } from './content-types.js';
import { isLinesBlock, isClearBlock, isObjectBlock } from './content-types.js';

/**
 * Estimate the number of terminal rows a content block will occupy,
 * including 1 row of marginBottom.
 */
export function estimateBlockHeight(
  block: ContentBlock,
  availableWidth: number,
): number {
  if (typeof block === 'string') {
    return wordWrap(block, availableWidth).length + 1; // +1 for marginBottom
  }

  if (isClearBlock(block)) return 0;

  if (isLinesBlock(block)) {
    return block.lines.length + 1;
  }

  if (isObjectBlock(block)) {
    if (typeof block.content === 'string') {
      return wordWrap(block.content, availableWidth).length + 1;
    }
    return 4; // conservative fixed estimate for ReactNode
  }

  return 1;
}

/**
 * Given all blocks, the active index, available width, and a row budget,
 * return [startIdx, endIdx] — the range of blocks to render.
 *
 * Always includes activeIdx. Walks backward to include as many completed
 * blocks as fit within maxHeight.
 */
export function computeVisibleRange(
  blocks: ContentBlock[],
  activeIdx: number,
  availableWidth: number,
  maxHeight: number,
): [number, number] {
  // Reserve a 2-row buffer so resize-induced estimate drift doesn't
  // cause overflow="hidden" to clip the margin between blocks.
  const budget = Math.max(4, maxHeight - 2);

  let totalHeight = estimateBlockHeight(blocks[activeIdx], availableWidth);
  let start = activeIdx;

  for (let i = activeIdx - 1; i >= 0; i--) {
    // Clear blocks act as a hard boundary — don't show anything before them
    if (isClearBlock(blocks[i])) break;
    const h = estimateBlockHeight(blocks[i], availableWidth);
    if (totalHeight + h > budget) break;
    totalHeight += h;
    start = i;
  }

  return [start, activeIdx];
}

/**
 * Word-wrap text at clean word boundaries. Always returns pre-wrapped text
 * joined with \n — this avoids Ink's native wrap which can leave leading
 * spaces on continuation lines.
 *
 * Uses a 1-char safety margin so slight width estimate mismatches don't
 * cause Ink to re-wrap our already-wrapped lines.
 */
export function wordWrap(text: string, availableWidth: number): string[] {
  const safeWidth = Math.max(10, availableWidth - 1);
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (
      currentLine.length + word.length + 1 > safeWidth &&
      currentLine.length > 0
    ) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine += (currentLine.length > 0 ? ' ' : '') + word;
    }
  }
  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines;
}

/**
 * Word-wrap text and return only the last `maxRows` lines.
 * Used for intra-block truncation when a single text block exceeds the viewport.
 * Also used for normal rendering to avoid Ink's leading-space wrap artifacts.
 */
export function wrapAndTruncate(
  text: string,
  availableWidth: number,
  maxRows: number,
): string {
  const lines = wordWrap(text, availableWidth);

  if (lines.length <= maxRows) {
    return lines.join('\n');
  }

  return lines.slice(-maxRows).join('\n');
}
