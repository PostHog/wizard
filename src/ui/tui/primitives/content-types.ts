/**
 * Content block types and type guards.
 *
 * Extracted from ContentSequencer so that pure-logic modules (like
 * layout-helpers) can import them without pulling in Ink/React.
 */

import type { ReactNode } from 'react';
import type { TextRevealMode } from './TextBlock.js';

/** Object form — string or ReactNode content with per-block overrides. */
export interface ContentObjectBlock {
  content: string | ReactNode;
  mode?: TextRevealMode;
  animationInterval?: number;
  sentenceInterval?: number;
  pause?: number;
  persist?: boolean;
}

/** Lines block — reveals ReactNode lines one at a time. */
export interface ContentLinesBlock {
  type: 'lines';
  lines: ReactNode[];
  interval?: number;
  pause?: number;
}

/** Clear block — page break that hides all prior blocks. */
export interface ContentClearBlock {
  type: 'clear';
  pause?: number;
}

/** A content block in the sequence. Bare strings are sugar for { content: '...' }. */
export type ContentBlock =
  | string
  | ContentObjectBlock
  | ContentLinesBlock
  | ContentClearBlock;

/** Type guard for lines blocks. */
export function isLinesBlock(block: ContentBlock): block is ContentLinesBlock {
  return typeof block !== 'string' && 'type' in block && block.type === 'lines';
}

/** Type guard for clear blocks. */
export function isClearBlock(block: ContentBlock): block is ContentClearBlock {
  return typeof block !== 'string' && 'type' in block && block.type === 'clear';
}

/** Type guard for object blocks (text or node content). */
export function isObjectBlock(
  block: ContentBlock,
): block is ContentObjectBlock {
  return typeof block !== 'string' && !('type' in block);
}
