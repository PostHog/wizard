/**
 * DissolveTransition — Split-flap / digital rain wipe effect.
 *
 * A band of cycling random characters sweeps horizontally across the screen.
 * Behind the band: solid block (out phase) or clear (in phase).
 * Characters change every frame within the band, evoking a mechanical
 * split-flap display or Matrix-style digital rain.
 */

import { Box, Text } from 'ink';
import { useState, useEffect, useRef, type ReactNode } from 'react';

// Character pool: half-width katakana, digits, box-drawing, symbols
const GLYPHS =
  'ｦｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789:.<>╋╳╌╎═║╔╗╚╝░▒▓';

const FRAMES_PER_PHASE = 5;

export type WipeDirection = 'left' | 'right';

interface DissolveTransitionProps {
  transitionKey: string;
  width: number;
  height: number;
  children: ReactNode;
  direction?: WipeDirection;
  duration?: number; // ms per frame, default 30
}

function randomGlyph(): string {
  return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
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
  duration = 30,
}: DissolveTransitionProps) => {
  const [phase, setPhase] = useState<TransitionPhase>(TransitionPhase.Idle);
  const [frame, setFrame] = useState(0);
  const [activeDir, setActiveDir] = useState<WipeDirection>(direction);
  const prevKey = useRef(transitionKey);
  const pendingChildren = useRef<ReactNode>(children);
  const [displayChildren, setDisplayChildren] = useState<ReactNode>(children);
  // Random seed changes each frame to cycle the glyphs
  const [, setTick] = useState(0);

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
      setTick((t) => t + 1); // force re-render for new random glyphs
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

  // Wave front sweeps across columns.
  // The "band" is where random characters appear (the flipping zone).
  // Behind the band: solid █ (out) or space (in).
  // Ahead of the band: space (out) or █ (in).
  const waveFront = (frame + 1) / FRAMES_PER_PHASE;
  const bandWidth = 0.2; // narrow band
  const glyphDensity = 0.08; // only ~8% of band cells get a glyph

  const rows: string[] = [];
  for (let r = 0; r < height; r++) {
    let row = '';
    for (let c = 0; c < width; c++) {
      let colNorm: number;
      if (activeDir === 'left') {
        colNorm = width > 1 ? (width - 1 - c) / (width - 1) : 0;
      } else {
        colNorm = width > 1 ? c / (width - 1) : 0;
      }

      const colProgress = (waveFront - colNorm + bandWidth) / bandWidth;

      let char: string;
      if (phase === TransitionPhase.Out) {
        if (colProgress >= 1) {
          char = '█';
        } else if (colProgress > 0) {
          // Band: mostly shade blocks, rare glyph
          if (Math.random() < glyphDensity) {
            char = randomGlyph();
          } else {
            // Gradient through shades based on position in band
            const shade = Math.floor(colProgress * 4);
            char = ['░', '▒', '▓', '█'][shade];
          }
        } else {
          char = ' ';
        }
      } else {
        if (colProgress >= 1) {
          char = ' ';
        } else if (colProgress > 0) {
          if (Math.random() < glyphDensity) {
            char = randomGlyph();
          } else {
            const shade = Math.floor((1 - colProgress) * 4);
            char = ['░', '▒', '▓', '█'][shade];
          }
        } else {
          char = '█';
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
