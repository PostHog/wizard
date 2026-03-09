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
}

export const LinesBlock = ({
  lines,
  interval,
  active,
  completed,
  onComplete,
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

  return (
    <Box flexDirection="column">
      {lines.map((line, li) => {
        if (completed) {
          return (
            <Box key={li}>
              <Text dimColor>{line}</Text>
            </Box>
          );
        }
        if (li >= revealedCount) return null;
        const isCurrent = li === revealedCount - 1;
        return (
          <Box key={li}>
            {isCurrent ? <>{line}</> : <Text dimColor>{line}</Text>}
          </Box>
        );
      })}
    </Box>
  );
};
