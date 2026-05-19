/**
 * HedgehogRunner — playable arcade game shown while the audit runs.
 *
 * Game state lives in the parent (Audit3000RunScreen) so it survives tab
 * switches. This component owns the render loop (setInterval) and key
 * bindings; when the user switches tabs the component unmounts, the
 * interval clears, and state freezes in the parent — free pause behaviour.
 */

import { Box, Text } from 'ink';
import { Fragment, useEffect, type Dispatch, type SetStateAction } from 'react';
import { Colors } from '../../styles.js';
import { NEON_BLUE, NEON_GOLD, NEON_PINK } from './arcade-colors.js';
import { useStdoutDimensions } from '../../hooks/useStdoutDimensions.js';
import {
  useKeyBindings,
  KeyMatch,
  type KeyBinding,
} from '../../hooks/useKeyBindings.js';
import {
  HEDGEHOG_COL,
  PLAYFIELD_WIDTH,
  jump,
  restart,
  tick,
  type GameState,
} from './hedgehog-runner-engine.js';

const TICK_MS = 150;
const PLAYFIELD_ROWS = 3;
const MIN_TERMINAL_COLUMNS = 50;
const HEDGEHOG_GLYPH = 'O';
const SPIKE_GLYPH = '^';
const RING_GLYPH = 'o';
const GROUND_GLYPH = '=';

interface HedgehogRunnerProps {
  state: GameState;
  onChange: Dispatch<SetStateAction<GameState>>;
}

const pad4 = (n: number) => String(n).padStart(4, '0');

export const HedgehogRunner = ({ state, onChange }: HedgehogRunnerProps) => {
  const [columns] = useStdoutDimensions();

  useEffect(() => {
    const id = setInterval(() => {
      onChange((prev) => tick(prev));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [onChange]);

  const bindings: KeyBinding[] = [
    {
      match: KeyMatch.Space,
      label: 'space',
      action: 'jump',
      handler: () => onChange((prev) => jump(prev)),
    },
    {
      match: 'r',
      label: 'r',
      action: 'restart',
      handler: () =>
        onChange((prev) => (prev.isGameOver ? restart(prev) : prev)),
    },
  ];
  useKeyBindings('hedgehog-runner', bindings);

  if (columns < MIN_TERMINAL_COLUMNS) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text dimColor>
          Widen the terminal to at least {MIN_TERMINAL_COLUMNS} columns to play
          Hedgehog Runner.
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text bold color={NEON_BLUE}>
          SCORE {pad4(state.score)}
        </Text>
        <Text>{'     '}</Text>
        <Text bold color={NEON_GOLD}>
          HI {pad4(state.hiScore)}
        </Text>
        {state.isGameOver && (
          <>
            <Text>{'     '}</Text>
            <Text bold color="red">
              ✱ GAME OVER ✱
            </Text>
          </>
        )}
      </Box>

      {Array.from({ length: PLAYFIELD_ROWS }, (_, row) => (
        <PlayfieldRow key={row} row={row} state={state} />
      ))}

      <Text color={Colors.muted}>{GROUND_GLYPH.repeat(PLAYFIELD_WIDTH)}</Text>
    </Box>
  );
};

interface PlayfieldRowProps {
  row: number;
  state: GameState;
}

const PlayfieldRow = ({ row, state }: PlayfieldRowProps) => {
  const cells: Array<{ ch: string; color?: string; bold?: boolean }> = [];
  for (let x = 0; x < PLAYFIELD_WIDTH; x++) {
    if (x === HEDGEHOG_COL && row === state.hedgehogRow) {
      cells.push({ ch: HEDGEHOG_GLYPH, color: NEON_PINK, bold: true });
      continue;
    }
    const obstacle = state.obstacles.find((o) => o.x === x && o.row === row);
    if (obstacle) {
      cells.push(
        obstacle.kind === 'spike'
          ? { ch: SPIKE_GLYPH, color: 'red', bold: true }
          : { ch: RING_GLYPH, color: NEON_GOLD, bold: true },
      );
      continue;
    }
    cells.push({ ch: ' ' });
  }
  return (
    <Text>
      {cells.map((c, i) => (
        <Fragment key={i}>
          {c.color ? (
            <Text color={c.color} bold={c.bold}>
              {c.ch}
            </Text>
          ) : (
            c.ch
          )}
        </Fragment>
      ))}
    </Text>
  );
};
