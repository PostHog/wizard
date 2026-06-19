/**
 * CrateStack — dependency-install phase.
 *
 * Boxes drop from the top and stack at the bottom. Each new arrival lands
 * with a tiny shake.
 */

import { Box, Text } from 'ink';
import { useRef } from 'react';
import { useTick } from '@ui/tui/hooks/useTick';
import { Panel, type VisualProps } from './panel';
import { VISUALIZER_PALETTE } from './palette';

const PACKAGE_NAMES = [
  'posthog-js',
  'posthog-py',
  'posthog-rb',
  'posthog-go',
  'posthog-node',
  'react-ph',
  'next-ph',
  'svelte-ph',
  'ph-mcp',
  'ph-ai',
];
// Crate width is derived from the longest label so names never get sliced.
const CRATE_CONTENT_W = Math.max(...PACKAGE_NAMES.map((n) => n.length));
const CRATE_W = CRATE_CONTENT_W + 2;

interface CrateState {
  stack: { label: string; x: number; landedAt: number }[];
  falling: { label: string; x: number; y: number } | null;
  spawnCooldown: number;
}

export const CrateStack = ({ width, height }: VisualProps) => {
  const tick = useTick(95);
  const stateRef = useRef<CrateState>({
    stack: [],
    falling: null,
    spawnCooldown: 0,
  });

  const state = stateRef.current;
  const crateW = CRATE_W;
  const crateH = 1;
  const floorY = height - 1;

  if (state.falling) {
    state.falling.y += 1;
    const collisionStackHeight =
      state.stack.filter((c) => Math.abs(c.x - state.falling!.x) < crateW - 1)
        .length * crateH;
    if (state.falling.y >= floorY - collisionStackHeight) {
      state.stack.push({
        label: state.falling.label,
        x: state.falling.x,
        landedAt: tick,
      });
      state.falling = null;
      state.spawnCooldown = 3;
    }
  } else if (state.spawnCooldown > 0) {
    state.spawnCooldown -= 1;
  } else if (state.stack.length < Math.floor(height / crateH) - 1) {
    state.falling = {
      label: PACKAGE_NAMES[Math.floor(Math.random() * PACKAGE_NAMES.length)],
      x: 2 + Math.floor(Math.random() * Math.max(1, width - crateW - 4)),
      y: -1,
    };
  } else {
    // Stack full — wipe and restart for the next cycle.
    if (tick % 20 === 0) {
      state.stack = [];
    }
  }

  const grid: string[][] = Array.from({ length: height }, () =>
    new Array(width).fill(' '),
  );
  const drawCrate = (cx: number, cy: number, label: string, shake: number) => {
    const x = cx + shake;
    if (cy < 0 || cy >= height) return;
    const labelTrimmed = label.slice(0, crateW - 2);
    const padded = `[${labelTrimmed}]`.padEnd(crateW, ' ');
    for (let i = 0; i < crateW && x + i < width; i++) {
      if (x + i >= 0) grid[cy][x + i] = padded[i];
    }
  };

  state.stack.forEach((c, idx) => {
    const cy = floorY - idx;
    const shake =
      tick - c.landedAt === 0 ? 1 : tick - c.landedAt === 1 ? -1 : 0;
    drawCrate(c.x, cy, c.label, shake);
  });
  if (state.falling) {
    drawCrate(state.falling.x, state.falling.y, state.falling.label, 0);
  }

  return (
    <Panel>
      {grid.map((row, y) => (
        <Box key={y}>
          {row.map((ch, x) => {
            if (ch === ' ') return <Text key={x}> </Text>;
            const isFalling =
              state.falling &&
              y === state.falling.y &&
              Math.abs(x - state.falling.x) < crateW;
            return (
              <Text
                key={x}
                bold={isFalling}
                color={
                  isFalling ? VISUALIZER_PALETTE.head : VISUALIZER_PALETTE.mid
                }
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
