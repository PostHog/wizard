/**
 * Tumblers — env-setup phase.
 *
 * Pins fall into a lock cylinder one by one; when all six align the bolt
 * pulses green for a beat, then the cycle restarts.
 */

import { Box, Text } from 'ink';
import { useRef } from 'react';
import { useTick } from '@ui/tui/hooks/useTick';
import { MATRIX_FADE, Panel, type VisualProps } from './panel';
import { VISUALIZER_PALETTE } from './palette';

interface TumblerState {
  heights: number[]; // settled height per pin, 0 = unset
  current: number; // index of pin currently falling
  fallY: number; // current Y of the falling pin (in rows)
  pulse: number; // pulse counter once all pins land
}

export const Tumblers = ({ width, height }: VisualProps) => {
  const tick = useTick(80);
  const pinCount = Math.min(Math.floor((width - 2) / 2), 6);
  const stateRef = useRef<TumblerState>({
    heights: new Array(pinCount).fill(0),
    current: 0,
    fallY: 0,
    pulse: 0,
  });
  const state = stateRef.current;

  const cylinderTop = 1;
  const cylinderBottom = height - 2;
  // Clamp to the cylinder interior: on short panels the raw formula can drop a
  // pin's target above cylinderTop (even negative), which used to be written
  // back as a settled height and indexed as grid[negativeRow][pinX] -> crash.
  const targetForPin = (i: number) =>
    Math.max(
      cylinderTop,
      Math.min(cylinderBottom, cylinderBottom - 1 - (i % 3) - Math.floor(i / 2)),
    );

  if (state.pulse > 0) {
    state.pulse -= 1;
    if (state.pulse === 0) {
      state.heights = new Array(pinCount).fill(0);
      state.current = 0;
      state.fallY = 0;
    }
  } else if (state.current < pinCount) {
    state.fallY += 1;
    if (state.fallY >= targetForPin(state.current)) {
      state.heights[state.current] = targetForPin(state.current);
      state.current += 1;
      state.fallY = cylinderTop;
    }
  } else {
    state.pulse = 14;
  }

  const grid: string[][] = Array.from({ length: height }, () =>
    new Array(width).fill(' '),
  );
  // Outer cylinder walls
  for (let y = 0; y < height; y++) {
    grid[y][0] = '│';
    grid[y][width - 1] = '│';
  }
  // Top notches (where pins enter)
  for (let i = 0; i < pinCount; i++) {
    const x = 1 + i * 2 + 1;
    if (x < width) grid[0][x] = '▼';
  }
  // Floor
  for (let x = 1; x < width - 1; x++) grid[height - 1][x] = '─';
  // Settled pins
  for (let i = 0; i < pinCount; i++) {
    const pinX = 1 + i * 2 + 1;
    if (pinX >= width) continue;
    const top = state.heights[i] || cylinderTop;
    for (let y = top; y <= cylinderBottom; y++) {
      if (y >= 0 && y < height) grid[y][pinX] = '█';
    }
  }
  // Falling pin
  if (state.pulse === 0 && state.current < pinCount) {
    const pinX = 1 + state.current * 2 + 1;
    if (pinX < width && state.fallY >= 0 && state.fallY < height) {
      grid[state.fallY][pinX] = '█';
    }
  }

  const pulsing = state.pulse > 0;
  const pulseBright = pulsing && tick % 2 === 0;
  return (
    <Panel>
      {grid.map((row, y) => (
        <Box key={y}>
          {row.map((ch, x) => {
            if (ch === ' ') return <Text key={x}> </Text>;
            if (ch === '│' || ch === '─' || ch === '▼') {
              const c = pulsing
                ? pulseBright
                  ? VISUALIZER_PALETTE.bright
                  : MATRIX_FADE
                : MATRIX_FADE;
              return (
                <Text key={x} color={c} dimColor={!pulsing}>
                  {ch}
                </Text>
              );
            }
            const isFalling =
              state.pulse === 0 &&
              state.current < pinCount &&
              y === state.fallY &&
              x === 1 + state.current * 2 + 1;
            const color = pulsing
              ? pulseBright
                ? VISUALIZER_PALETTE.head
                : VISUALIZER_PALETTE.bright
              : isFalling
              ? VISUALIZER_PALETTE.head
              : VISUALIZER_PALETTE.mid;
            return (
              <Text key={x} bold={pulsing || isFalling} color={color}>
                {ch}
              </Text>
            );
          })}
        </Box>
      ))}
    </Panel>
  );
};
