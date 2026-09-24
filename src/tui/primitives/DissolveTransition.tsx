/**
 * DissolveTransition — Column-sweep inspired by TTE's Sweep effect.
 *
 * Uses a SequenceEaser (in_out_circ) to activate columns with eased pacing.
 * Each activated column cycles through shade characters (░▒▓█) independently.
 *
 * Out phase: columns sweep, building up shade chars until solid █ (covers old content).
 * In phase: columns sweep in reverse, dissolving █ back through shades to empty (reveals new content).
 */

import { Box, Text } from 'ink';
import { useState, useEffect, useRef, type ReactNode } from 'react';

/** Shade characters in build-up order (light → solid). */
const SHADES = ['░', '▒', '▓', '█'] as const;
/** How many ticks each shade character displays before advancing. */
const TICKS_PER_SHADE = 2;
/** Total ticks a column needs to complete its shade cycle. */
const SHADE_CYCLE_TICKS = SHADES.length * TICKS_PER_SHADE;

export type WipeDirection = 'left' | 'right';

interface DissolveTransitionProps {
  transitionKey: string;
  width: number;
  height: number;
  children: ReactNode;
  direction?: WipeDirection;
  duration?: number;
}

function easeInOutCirc(t: number): number {
  if (t < 0.5) {
    return (1 - Math.sqrt(1 - 4 * t * t)) / 2;
  }
  return (Math.sqrt(1 - (2 * t - 2) ** 2) + 1) / 2;
}

enum TransitionPhase {
  Idle = 'idle',
  Out = 'out',
  In = 'in',
}

export const DissolveTransition = ({
  transitionKey,
  width,
  height,
  children,
  direction = 'left',
  duration = 2,
}: DissolveTransitionProps) => {
  const [phase, setPhase] = useState<TransitionPhase>(TransitionPhase.Idle);
  const [tick, setTick] = useState(0);
  const [activeDir, setActiveDir] = useState<WipeDirection>(direction);
  const prevKey = useRef(transitionKey);
  const pendingChildren = useRef<ReactNode>(children);
  const [displayChildren, setDisplayChildren] = useState<ReactNode>(children);

  // Track when each column was activated (tick number), -1 means not yet.
  const columnActivationTick = useRef<number[]>([]);

  useEffect(() => {
    if (transitionKey !== prevKey.current) {
      prevKey.current = transitionKey;
      pendingChildren.current = children;
      setActiveDir(direction);
      setPhase(TransitionPhase.Out);
      setTick(0);
      columnActivationTick.current = new Array(width).fill(-1);
    } else if (phase !== TransitionPhase.Idle) {
      // Terminal resized mid-transition — abort and show new content immediately
      setPhase(TransitionPhase.Idle);
      setDisplayChildren(children);
    } else {
      setDisplayChildren(children);
    }
  }, [transitionKey, children, width, height, phase, direction]);

  useEffect(() => {
    if (phase === TransitionPhase.Idle) return;

    const timer = setInterval(() => {
      setTick((prev) => prev + 1);
    }, duration);

    return () => clearInterval(timer);
  }, [phase, duration]);

  // Easer steps = width: roughly one column activates per tick.
  // This keeps the sweep front tight (only a few columns in-flight at once).
  const easerSteps = width;

  // A phase ends when the easer has completed AND all columns have finished their shade cycle.
  const maxTicks = easerSteps + SHADE_CYCLE_TICKS;

  useEffect(() => {
    if (phase === TransitionPhase.Idle) return;
    if (tick >= maxTicks) {
      if (phase === TransitionPhase.Out) {
        setDisplayChildren(pendingChildren.current);
        setPhase(TransitionPhase.In);
        setTick(0);
        columnActivationTick.current = new Array(width).fill(-1);
      } else {
        setPhase(TransitionPhase.Idle);
      }
    }
  }, [tick, phase, maxTicks, width]);

  if (phase === TransitionPhase.Idle) {
    return <>{displayChildren}</>;
  }

  // --- SequenceEaser logic ---
  // Map current tick to easer progress (0..1), apply easing,
  // then determine how many columns should be activated.
  const easerProgress = Math.min(tick / easerSteps, 1);
  const easedValue = easeInOutCirc(easerProgress);
  const activatedCount = Math.floor(easedValue * width);

  // Build column order based on direction.
  // "left" means sweep moves left-to-right; "right" means right-to-left.
  // TTE's COLUMN_RIGHT_TO_LEFT activates rightmost first.
  const columnOrder: number[] = [];
  if (activeDir === 'left') {
    for (let c = width - 1; c >= 0; c--) columnOrder.push(c);
  } else {
    for (let c = 0; c < width; c++) columnOrder.push(c);
  }

  // Activate columns that should be active but aren't yet.
  for (let i = 0; i < activatedCount && i < columnOrder.length; i++) {
    const col = columnOrder[i];
    if (columnActivationTick.current[col] === -1) {
      columnActivationTick.current[col] = tick;
    }
  }

  // --- Render frame ---
  const rows: string[] = [];
  for (let r = 0; r < height; r++) {
    let row = '';
    for (let c = 0; c < width; c++) {
      const activatedAt = columnActivationTick.current[c];

      let char: string;
      if (activatedAt === -1) {
        // Not yet activated
        char = phase === TransitionPhase.Out ? ' ' : '█';
      } else {
        // Column is activated — determine shade based on ticks since activation
        const age = tick - activatedAt;
        const shadeIndex = Math.min(
          Math.floor(age / TICKS_PER_SHADE),
          SHADES.length - 1,
        );

        if (phase === TransitionPhase.Out) {
          // Building up: ░ → ▒ → ▓ → █
          char = SHADES[shadeIndex];
        } else {
          // Dissolving: █ → ▓ → ▒ → ░ → space
          if (shadeIndex >= SHADES.length - 1 && age >= SHADE_CYCLE_TICKS) {
            char = ' ';
          } else {
            char = SHADES[SHADES.length - 1 - shadeIndex];
          }
        }
      }

      row += char;
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
