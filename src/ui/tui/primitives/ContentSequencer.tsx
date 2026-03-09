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
  /** Resume from a previously persisted block index. */
  initialBlockIdx?: number;
  /** Called whenever the active block index advances. */
  onBlockChange?: (idx: number) => void;
  /** Called once when the last block completes (after its pause). */
  onSequenceComplete?: () => void;
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
  initialBlockIdx = 0,
  onBlockChange,
  onSequenceComplete,
}: ContentSequencerProps) => {
  const resuming = initialBlockIdx > 0;
  const [activeIdx, setActiveIdx] = useState(
    resuming ? initialBlockIdx : startDelay > 0 ? -1 : 0,
  );
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initial delay before first block (skip when resuming)
  useEffect(() => {
    if (resuming || startDelay <= 0 || activeIdx !== -1) return;
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
      // Last block — fire sequence-complete after its pause, don't advance
      if (activeIdx >= blocks.length - 1) {
        if (onSequenceComplete && !transitionTimer.current) {
          const pause = getBlockPause(blocks[blockIndex], blockInterval);
          transitionTimer.current = setTimeout(() => {
            transitionTimer.current = null;
            onSequenceComplete();
          }, pause);
        }
        return;
      }
      // Don't double-trigger
      if (transitionTimer.current) return;

      const pause = getBlockPause(blocks[blockIndex], blockInterval);
      transitionTimer.current = setTimeout(() => {
        transitionTimer.current = null;
        setActiveIdx((i) => {
          const next = i + 1;
          onBlockChange?.(next);
          return next;
        });
      }, pause);
    },
    [activeIdx, blocks, blockInterval, onBlockChange, onSequenceComplete],
  );

  // Find the most recent clear block — nothing before it renders.
  // When the active block IS a clear block, immediately hide all prior content
  // so the pause shows a blank screen (not dim prior text).
  const clearFloor = useMemo(() => {
    if (activeIdx >= 0 && isClearBlock(blocks[activeIdx])) return activeIdx;
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
