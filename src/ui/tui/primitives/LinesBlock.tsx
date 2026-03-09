/**
 * LinesBlock — Reveals ReactNode lines one at a time.
 * Each line can contain colors, bold, ASCII art — any JSX.
 */

import { Box, Text } from 'ink';
import { useState, useEffect, type ReactNode } from 'react';

interface LinesBlockProps {
  lines: ReactNode[];
  interval: number;
  active: boolean;
  completed: boolean;
  onComplete: () => void;
  /** Max rows this block may occupy. When exceeded, top lines are truncated. */
  maxHeight?: number;
}

export const LinesBlock = ({
  lines,
  interval,
  active,
  completed,
  onComplete,
  maxHeight,
}: LinesBlockProps) => {
  const [revealedCount, setRevealedCount] = useState(0);

  // Reveal lines one at a time
  useEffect(() => {
    if (!active || revealedCount >= lines.length) return;
    const timer = setTimeout(
      () => setRevealedCount((c) => c + 1),
      revealedCount === 0 ? 0 : interval,
    );
    return () => clearTimeout(timer);
  }, [active, revealedCount, lines.length, interval]);

  // Fire onComplete when all lines revealed
  useEffect(() => {
    if (active && revealedCount >= lines.length) onComplete();
  }, [active, revealedCount, lines.length, onComplete]);

  // When maxHeight is set, only show the last maxHeight lines
  const visibleStart =
    maxHeight != null
      ? Math.max(0, (completed ? lines.length : revealedCount) - maxHeight)
      : 0;

  return (
    <Box flexDirection="column">
      {lines.map((line, li) => {
        if (completed) {
          if (li < visibleStart) return null;
          return (
            <Box key={li}>
              <Text dimColor>{line}</Text>
            </Box>
          );
        }
        if (li >= revealedCount || li < visibleStart) return null;
        return <Box key={li}>{line}</Box>;
      })}
    </Box>
  );
};
