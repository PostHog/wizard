/**
 * ContentSequencer — Plays content blocks in order.
 *
 * Each block is a self-animating component that fires onComplete() when done.
 * The sequencer waits blockInterval ms between blocks, then advances.
 *
 * Block types:
 *   - string     → TextBlock  (animated text)
 *   - lines      → LinesBlock (line-by-line reveal)
 *   - node       → NodeBlock  (static JSX)
 */

import { Box } from 'ink';
import { useState, useCallback, useRef, type ReactNode } from 'react';
import { TextBlock, type TextRevealMode } from './TextBlock.js';
import { LinesBlock } from './LinesBlock.js';
import { NodeBlock } from './NodeBlock.js';

/** A content block in the sequence. */
export type ContentBlock =
  | string
  | { type: 'lines'; lines: ReactNode[]; interval?: number; pause?: number }
  | { type: 'node'; content: ReactNode; pause?: number };

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
  bullet?: ReactNode;
  animationInterval?: number;
  sentenceInterval?: number;
  lineInterval?: number;
  blockInterval?: number;
}

export const ContentSequencer = ({
  blocks,
  mode,
  bullet,
  animationInterval,
  sentenceInterval,
  lineInterval = 200,
  blockInterval = 3200,
}: ContentSequencerProps) => {
  const [activeIdx, setActiveIdx] = useState(0);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  return (
    <Box flexDirection="column">
      {blocks.map((block, i) => {
        if (i > activeIdx) return null;
        const active = i === activeIdx;
        const completed = i < activeIdx;

        // Completed node blocks don't render (can't dim Box content)
        if (completed && typeof block !== 'string' && block.type === 'node') {
          return null;
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
}: BlockRendererProps) => {
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
      />
    );
  }

  if (block.type === 'lines') {
    return (
      <LinesBlock
        lines={block.lines}
        interval={block.interval ?? lineInterval}
        active={active}
        completed={completed}
        onComplete={onComplete}
      />
    );
  }

  if (block.type === 'node') {
    return (
      <NodeBlock
        content={block.content}
        active={active}
        onComplete={onComplete}
      />
    );
  }

  return null;
};
