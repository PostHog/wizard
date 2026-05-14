/**
 * LetterCard — Renders the concierge notification's long-form letter on the
 * left of the run screen. Wraps text to the available width and scrolls one
 * visual row at a time via up/down (or a page at a time via page-up/down).
 *
 * Layout mirrors LogViewer: content fills the viewport, the scroll indicator
 * sits at the bottom in a dim line.
 */

import { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Colors } from '../styles.js';
import { useStdoutDimensions } from '../hooks/useStdoutDimensions.js';

/** Rows consumed by title bar + spacer + tab bar + status line + indicator. */
const CHROME_ROWS = 10;

interface LetterCardProps {
  /** Full body of the letter. May contain `\n` and `\r\n`. */
  letter: string;
}

/** Soft-wrap a paragraph to `width` columns at word boundaries. */
function wrapParagraph(paragraph: string, width: number): string[] {
  if (paragraph.length === 0) return [''];
  const out: string[] = [];
  for (const word of paragraph.split(/\s+/).filter(Boolean)) {
    if (out.length === 0) {
      out.push(word);
      continue;
    }
    const last = out[out.length - 1];
    if (last.length + 1 + word.length <= width) {
      out[out.length - 1] = `${last} ${word}`;
    } else if (word.length <= width) {
      out.push(word);
    } else {
      // Word longer than the column — hard-split it.
      let remaining = word;
      while (remaining.length > width) {
        out.push(remaining.slice(0, width));
        remaining = remaining.slice(width);
      }
      out.push(remaining);
    }
  }
  return out.length === 0 ? [''] : out;
}

function wrapAll(text: string, width: number): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows: string[] = [];
  for (const paragraph of normalized.split('\n')) {
    for (const row of wrapParagraph(paragraph, Math.max(1, width))) {
      rows.push(row);
    }
  }
  return rows;
}

export const LetterCard = ({ letter }: LetterCardProps) => {
  const [columns, rows] = useStdoutDimensions();
  // SplitView splits (columns - gap) in half; subtract a small buffer so Ink
  // doesn't re-wrap rows sitting at the boundary (the re-wrap was clipping
  // the first character of long rows in the previous layout).
  const wrapWidth = Math.max(20, Math.floor((columns - 2) / 2) - 4);
  const viewportHeight = Math.max(4, rows - CHROME_ROWS);

  const wrapped = useMemo(
    () => wrapAll(letter, wrapWidth),
    [letter, wrapWidth],
  );
  const [offset, setOffset] = useState(0);
  const maxOffset = Math.max(0, wrapped.length - viewportHeight);

  useInput((_input, key) => {
    if (key.upArrow) setOffset((o) => Math.max(0, o - 1));
    else if (key.downArrow) setOffset((o) => Math.min(maxOffset, o + 1));
    else if (key.pageUp) setOffset((o) => Math.max(0, o - viewportHeight));
    else if (key.pageDown)
      setOffset((o) => Math.min(maxOffset, o + viewportHeight));
  });

  const clampedOffset = Math.min(offset, maxOffset);
  const visible = wrapped.slice(clampedOffset, clampedOffset + viewportHeight);
  const lastRow = Math.min(wrapped.length, clampedOffset + viewportHeight);
  const canScrollUp = clampedOffset > 0;
  const canScrollDown = clampedOffset < maxOffset;

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" height={viewportHeight}>
        {visible.map((row, i) => (
          <Text
            key={`${clampedOffset}-${i}`}
            color={Colors.muted}
            wrap="truncate"
          >
            {row || ' '}
          </Text>
        ))}
      </Box>
      <Box>
        <Text dimColor>
          Letter {clampedOffset + 1}–{lastRow} / {wrapped.length}
          {maxOffset > 0
            ? `  ${canScrollUp ? '↑' : ' '}${
                canScrollDown ? '↓' : ' '
              } (↑↓ scroll)`
            : ''}
        </Text>
      </Box>
    </Box>
  );
};
