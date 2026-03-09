/**
 * ContentSequencer — Plays content blocks in order.
 *
 * Each block is a self-animating component that fires onComplete() when done.
 * The sequencer waits blockInterval ms between blocks, then advances.
 *
 * Block types:
 *   - string            → TextBlock  (animated text, sugar for { content: '...' })
 *   - { content: str }  → TextBlock  (animated text with per-block overrides)
 *   - { content: JSX }  → NodeBlock  (static JSX)
 *   - { type: 'lines' } → LinesBlock (line-by-line reveal)
 *   - { type: 'clear' } → ClearBlock (page break — hides all prior blocks)
 */

import { Box } from 'ink';
import {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  type ReactNode,
} from 'react';
import { TextBlock, type TextRevealMode } from './TextBlock.js';
import { LinesBlock } from './LinesBlock.js';
import { NodeBlock } from './NodeBlock.js';
import { computeVisibleRange } from './layout-helpers.js';

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

/** Resolve the pause after a block completes. */
export function getBlockPause(
  block: ContentBlock,
  blockInterval: number,
): number {
  if (typeof block === 'string') return blockInterval;
  return block.pause ?? blockInterval;
}

interface ContentSequencerProps {
  blocks: ContentBlock[];
  mode: TextRevealMode;
  /** Row budget for visible content. When set, older blocks are evicted. */
  maxHeight?: number;
  /** Available text width in columns (for height estimation). */
  availableWidth?: number;
  bullet?: ReactNode;
  animationInterval?: number;
  sentenceInterval?: number;
  lineInterval?: number;
  blockInterval?: number;
  /** Delay in ms before the first block appears. */
  startDelay?: number;
}

export const ContentSequencer = ({
  blocks,
  mode,
  maxHeight,
  availableWidth,
  bullet,
  animationInterval,
  sentenceInterval,
  lineInterval = 200,
  blockInterval = 3200,
  startDelay = 0,
}: ContentSequencerProps) => {
  const [activeIdx, setActiveIdx] = useState(startDelay > 0 ? -1 : 0);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initial delay before first block
  useEffect(() => {
    if (startDelay <= 0 || activeIdx !== -1) return;
    const timer = setTimeout(() => setActiveIdx(0), startDelay);
    return () => clearTimeout(timer);
  }, [startDelay, activeIdx]);

  // Compute visible range reactively (re-evaluates on resize, block advance, etc.)
  const [visibleStart, visibleEnd] = useMemo(() => {
    if (activeIdx < 0) return [0, -1] as [number, number];
    if (maxHeight == null || availableWidth == null) {
      return [0, activeIdx] as [number, number];
    }
    return computeVisibleRange(blocks, activeIdx, availableWidth, maxHeight);
  }, [blocks, activeIdx, maxHeight, availableWidth]);

  const handleComplete = useCallback(
    (blockIndex: number) => {
      // Only the active block can trigger advancement
      if (blockIndex !== activeIdx) return;
      // Don't advance past the last block
      if (activeIdx >= blocks.length - 1) return;
      // Don't double-trigger
      if (transitionTimer.current) return;

      const pause = getBlockPause(blocks[blockIndex], blockInterval);
      transitionTimer.current = setTimeout(() => {
        transitionTimer.current = null;
        setActiveIdx((i) => i + 1);
      }, pause);
    },
    [activeIdx, blocks, blockInterval],
  );

  // Find the most recent completed clear block — nothing before it renders.
  const clearFloor = useMemo(() => {
    for (let i = activeIdx - 1; i >= 0; i--) {
      if (isClearBlock(blocks[i])) return i + 1;
    }
    return 0;
  }, [blocks, activeIdx]);

  return (
    <Box flexDirection="column">
      {blocks.map((block, i) => {
        // Not yet reached
        if (i > activeIdx) return null;
        // Hidden by clear block
        if (i < clearFloor) return null;
        // Completed clear blocks don't render (active ones must mount to fire onComplete)
        if (isClearBlock(block) && i < activeIdx) return null;
        // Evicted by viewport
        if (i < visibleStart || i > visibleEnd) return null;

        const active = i === activeIdx;
        const completed = i < activeIdx;

        // Completed non-text blocks don't persist by default
        if (completed && isObjectBlock(block)) {
          const isText = typeof block.content === 'string';
          const shouldPersist = block.persist ?? isText;
          if (!shouldPersist) return null;
        }

        return (
          <Box key={i} flexDirection="column" marginBottom={1}>
            <BlockRenderer
              block={block}
              active={active}
              completed={completed}
              onComplete={() => handleComplete(i)}
              mode={mode}
              bullet={bullet}
              animationInterval={animationInterval}
              sentenceInterval={sentenceInterval}
              lineInterval={lineInterval}
              maxHeight={maxHeight}
              availableWidth={availableWidth}
            />
          </Box>
        );
      })}
    </Box>
  );
};

interface BlockRendererProps {
  block: ContentBlock;
  active: boolean;
  completed: boolean;
  onComplete: () => void;
  mode: TextRevealMode;
  bullet?: ReactNode;
  animationInterval?: number;
  sentenceInterval?: number;
  lineInterval: number;
  maxHeight?: number;
  availableWidth?: number;
}

const BlockRenderer = ({
  block,
  active,
  completed,
  onComplete,
  mode,
  bullet,
  animationInterval,
  sentenceInterval,
  lineInterval,
  maxHeight,
  availableWidth,
}: BlockRendererProps) => {
  // Clear block — completes immediately, renders nothing
  if (isClearBlock(block)) {
    useEffect(() => {
      if (active) onComplete();
    }, [active, onComplete]);
    return null;
  }

  // Bare string sugar → TextBlock with sequencer defaults
  if (typeof block === 'string') {
    return (
      <TextBlock
        text={block}
        active={active}
        completed={completed}
        onComplete={onComplete}
        mode={mode}
        bullet={bullet}
        animationInterval={animationInterval}
        sentenceInterval={sentenceInterval}
        maxHeight={maxHeight}
        availableWidth={availableWidth}
      />
    );
  }

  // Lines block
  if (isLinesBlock(block)) {
    return (
      <LinesBlock
        lines={block.lines}
        interval={block.interval ?? lineInterval}
        active={active}
        completed={completed}
        onComplete={onComplete}
        maxHeight={maxHeight}
      />
    );
  }

  // Object block — dispatch on content type
  if (typeof block.content === 'string') {
    return (
      <TextBlock
        text={block.content}
        active={active}
        completed={completed}
        onComplete={onComplete}
        mode={block.mode ?? mode}
        bullet={bullet}
        animationInterval={block.animationInterval ?? animationInterval}
        sentenceInterval={block.sentenceInterval ?? sentenceInterval}
        maxHeight={maxHeight}
        availableWidth={availableWidth}
      />
    );
  }

  return (
    <NodeBlock
      content={block.content}
      active={active}
      completed={completed}
      onComplete={onComplete}
    />
  );
};
