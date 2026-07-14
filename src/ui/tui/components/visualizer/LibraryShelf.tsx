/**
 * LibraryShelf — skill-selection phase.
 *
 * A row of book spines. One spine peels forward each cycle, the chosen
 * title hovers next to it, then it slides home and the next one is picked.
 */

import { Box, Text } from 'ink';
import { useTick } from '@ui/tui/hooks/useTick';
import { MATRIX_FADE, Panel, type VisualProps } from './panel';
import { createGrid, plot, writeText } from './grid';
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

  // Clamp the shelf so all three book rows stay on-grid on short panels; the
  // grid writes are bounds-safe anyway, but this keeps the books visible.
  const shelfY = Math.min(Math.max(1, Math.floor(height / 2) - 1), height - 3);
  const rows = createGrid(width, height);

  for (let i = 0; i < bookCount; i++) {
    const x = 1 + i * 2;
    const isSelected = i === selectedIdx;
    const shift = isSelected ? offset : 0;
    const wob = isSelected && wobble ? -1 : 0;
    plot(rows, x + shift, shelfY - 1, '█');
    plot(rows, x + shift, shelfY, BOOK_LABELS[i][0]);
    plot(rows, x + shift, shelfY + 1, BOOK_LABELS[i][1]);
    plot(rows, x + shift, shelfY + 2 + wob, '█');
  }

  // Shelf board underneath
  const boardY = shelfY + 3;
  for (let x = 0; x < width; x++) plot(rows, x, boardY, '─');
  // Floating label next to the selected book
  if (phase === 2) {
    const labelStartX = 1 + selectedIdx * 2 + 4;
    const labelText = BOOK_LABELS[selectedIdx] + '-app';
    writeText(rows, labelStartX, shelfY, labelText);
    plot(rows, labelStartX - 1, shelfY, '▶');
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
