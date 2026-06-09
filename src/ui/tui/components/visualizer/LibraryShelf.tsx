/**
 * LibraryShelf — skill-selection phase.
 *
 * A row of book spines. One spine peels forward each cycle, the chosen
 * title hovers next to it, then it slides home and the next one is picked.
 */

import { Box, Text } from 'ink';
import { useTick } from '@ui/tui/hooks/useTick';
import { MATRIX_FADE, Panel, type VisualProps } from './panel';
import { VISUALIZER_PALETTE } from './palette';

const BOOK_LABELS = [
  'nx',
  'rt',
  'sv',
  'fl',
  'jg',
  'rb',
  'go',
  'dj',
  'fa',
  'lv',
  'ts',
  'py',
];
const BOOK_COLORS = VISUALIZER_PALETTE.book;

export const LibraryShelf = ({ width, height }: VisualProps) => {
  const tick = useTick(380);
  const bookCount = Math.min(Math.floor((width - 2) / 2), BOOK_LABELS.length);
  // Cycle phases: 0 = at rest, 1 = selecting, 2 = pulled out, 3 = returning.
  const cyclePos = tick % (bookCount * 4);
  const selectedIdx = Math.floor(cyclePos / 4);
  const phase = cyclePos % 4;
  const offset = phase === 0 ? 0 : phase === 1 ? 1 : phase === 2 ? 2 : 1;
  const wobble = phase === 2 && tick % 2 === 0 ? 1 : 0;

  const shelfY = Math.floor(height / 2) - 1;
  const rows: string[][] = Array.from({ length: height }, () =>
    new Array(width).fill(' '),
  );

  for (let i = 0; i < bookCount; i++) {
    const x = 1 + i * 2;
    const isSelected = i === selectedIdx;
    const shift = isSelected ? offset : 0;
    const wob = isSelected && wobble ? -1 : 0;
    if (x + shift >= width) continue;
    rows[shelfY - 1][x + shift] = '█';
    rows[shelfY][x + shift] = BOOK_LABELS[i][0];
    rows[shelfY + 1][x + shift] = BOOK_LABELS[i][1];
    rows[shelfY + 2 + wob]?.[x + shift] !== undefined &&
      (rows[shelfY + 2 + wob][x + shift] = '█');
  }

  // Shelf board underneath
  const boardY = shelfY + 3;
  if (boardY < height) {
    for (let x = 0; x < width; x++) rows[boardY][x] = '─';
  }
  // Floating label next to the selected book
  if (phase === 2) {
    const labelStartX = 1 + selectedIdx * 2 + 4;
    const labelText = BOOK_LABELS[selectedIdx] + '-app';
    for (let c = 0; c < labelText.length && labelStartX + c < width; c++) {
      rows[shelfY][labelStartX + c] = labelText[c];
    }
    if (labelStartX - 1 < width && labelStartX - 1 >= 0) {
      rows[shelfY][labelStartX - 1] = '▶';
    }
  }

  return (
    <Panel>
      {rows.map((row, y) => (
        <Box key={y}>
          {row.map((ch, x) => {
            if (ch === ' ') return <Text key={x}> </Text>;
            if (ch === '─') {
              return (
                <Text key={x} color={MATRIX_FADE} dimColor>
                  ─
                </Text>
              );
            }
            if (ch === '▶') {
              return (
                <Text key={x} bold color={VISUALIZER_PALETTE.head}>
                  ▶
                </Text>
              );
            }
            const booksColor =
              BOOK_COLORS[
                (Math.floor((x - 1) / 2) + 17 * y) % BOOK_COLORS.length
              ];
            const selectedX = 1 + selectedIdx * 2 + offset;
            const isSel = x === selectedX;
            return (
              <Text
                key={x}
                bold={isSel}
                color={isSel ? VISUALIZER_PALETTE.head : booksColor}
              >
                {ch}
              </Text>
            );
          })}
        </Box>
      ))}
    </Panel>
  );
};
