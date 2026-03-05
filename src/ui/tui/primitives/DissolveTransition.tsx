/**
 * DissolveTransition — Subdividing checkerboard wipe effect.
 *
 * A checkerboard pattern sweeps right-to-left, covering old content with
 * increasingly fine blocks. Then the reverse reveals new content.
 *
 * Out phase: large blocks appear on the right, sweep left, then subdivide
 * to fill remaining gaps until the screen is solid.
 * In phase: blocks disappear right-to-left, revealing new content.
 */

import { Box, Text } from 'ink';
import { useState, useEffect, useRef, type ReactNode } from 'react';

const FRAMES_PER_PHASE = 16;

/**
 * Subdivision levels — block sizes approximate squares in terminal (2:1 char ratio).
 * Each level's checkerboard fills gaps left by the previous level.
 */
const LEVELS = [
  { w: 8, h: 4 },
  { w: 4, h: 2 },
  { w: 2, h: 1 },
  { w: 1, h: 1 },
];

/** Staggered start times for each level (0–1 range within a phase). */
const LEVEL_START = [0, 0.15, 0.3, 0.45];
/** Duration of each level's R→L sweep (as fraction of total phase). */
const SWEEP_DURATION = 0.55;

export type WipeDirection = 'left' | 'right';

interface DissolveTransitionProps {
  transitionKey: string;
  width: number;
  height: number;
  children: ReactNode;
  direction?: WipeDirection;
  duration?: number; // ms per frame, default 15
}

enum TransitionPhase {
  Idle = 'idle',
  Out = 'out',
  In = 'in',
}

/**
 * Has the sweep reached cell (r, c) at the given progress?
 * Checks all subdivision levels — if any level's checkerboard pattern
 * matches this cell AND the R→L sweep has reached it, returns true.
 */
function isCellSwept(
  r: number,
  c: number,
  width: number,
  progress: number,
  direction: WipeDirection,
): boolean {
  for (let l = 0; l < LEVELS.length; l++) {
    const { w, h } = LEVELS[l];

    // Checkerboard pattern: skip cells that don't match this level
    if ((Math.floor(r / h) + Math.floor(c / w)) % 2 !== 0) continue;

    // How far along is this level's sweep?
    const levelProgress = Math.max(
      0,
      Math.min(1, (progress - LEVEL_START[l]) / SWEEP_DURATION),
    );
    if (levelProgress <= 0) continue;

    // Column position normalized: 0 = leading edge, 1 = trailing edge
    let colNorm: number;
    if (direction === 'left') {
      // R→L: rightmost columns are swept first
      colNorm = width > 1 ? (width - 1 - c) / (width - 1) : 0;
    } else {
      colNorm = width > 1 ? c / (width - 1) : 0;
    }

    if (colNorm < levelProgress) return true;
  }
  return false;
}

export const DissolveTransition = ({
  transitionKey,
  width,
  height,
  children,
  direction = 'left',
  duration = 15,
}: DissolveTransitionProps) => {
  const [phase, setPhase] = useState<TransitionPhase>(TransitionPhase.Idle);
  const [frame, setFrame] = useState(0);
  const [activeDir, setActiveDir] = useState<WipeDirection>(direction);
  const prevKey = useRef(transitionKey);
  const pendingChildren = useRef<ReactNode>(children);
  const [displayChildren, setDisplayChildren] = useState<ReactNode>(children);

  useEffect(() => {
    if (transitionKey !== prevKey.current) {
      prevKey.current = transitionKey;
      pendingChildren.current = children;
      setActiveDir(direction);
      setPhase(TransitionPhase.Out);
      setFrame(0);
    } else if (phase === TransitionPhase.Idle) {
      setDisplayChildren(children);
    }
  }, [transitionKey, children, width, height, phase, direction]);

  useEffect(() => {
    if (phase === TransitionPhase.Idle) return;

    const timer = setInterval(() => {
      setFrame((prev) => {
        const next = prev + 1;
        if (phase === TransitionPhase.Out && next >= FRAMES_PER_PHASE) {
          setDisplayChildren(pendingChildren.current);
          setPhase(TransitionPhase.In);
          return 0;
        }
        if (phase === TransitionPhase.In && next >= FRAMES_PER_PHASE) {
          setPhase(TransitionPhase.Idle);
          return 0;
        }
        return next;
      });
    }, duration);

    return () => clearInterval(timer);
  }, [phase, duration]);

  if (phase === TransitionPhase.Idle) {
    return <>{displayChildren}</>;
  }

  const progress = (frame + 1) / FRAMES_PER_PHASE;

  const rows: string[] = [];
  for (let r = 0; r < height; r++) {
    let row = '';
    for (let c = 0; c < width; c++) {
      const swept = isCellSwept(r, c, width, progress, activeDir);

      if (phase === TransitionPhase.Out) {
        // Swept cells become covered (█), others stay empty
        row += swept ? '█' : ' ';
      } else {
        // Swept cells become revealed (empty), others stay covered
        row += swept ? ' ' : '█';
      }
    }
    rows.push(row);
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      {rows.map((row, i) => (
        <Text key={i} dimColor>
          {row}
        </Text>
      ))}
    </Box>
  );
};
