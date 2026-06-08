/**
 * MatrixRain — code-rain visual used for the codebase-scan phase.
 *
 * Independent of the phase orchestrator so it can be reused elsewhere
 * (e.g. standalone in a demo). `bordered` toggles the rounded green frame.
 */

import { Box, Text } from 'ink';
import { useEffect, useRef, useState } from 'react';
import { MATRIX_FADE } from './panel';

// Matrix code-rain palette: pale-green head fades through bright green and
// Matrix green to the deep, dimmed green at the tail's end.
const MATRIX_HEAD = '#E6FFE6';
const MATRIX_BRIGHT = '#7CFF7C';
const MATRIX_MID = '#22D622';

const DEFAULT_TICK_MS = 110;
const DEFAULT_MAX_TAIL = 7;
// Half-width katakana + digits + a few symbols — the classic Matrix code
// rain alphabet, all single-width in monospace terminals.
const RAIN_GLYPHS =
  'ｦｧｨｩｪｫｬｭｮｯｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789Z<>=*+:.';

interface RainColumn {
  headY: number;
  speed: number;
  tail: number;
  glyphs: Map<number, string>;
  dormant: number;
}

function pickGlyph(): string {
  return RAIN_GLYPHS[Math.floor(Math.random() * RAIN_GLYPHS.length)];
}

function makeRainColumn(height: number, maxTail: number): RainColumn {
  return {
    headY: -Math.random() * height,
    speed: 0.3 + Math.random() * 0.9,
    tail: 3 + Math.floor(Math.random() * (maxTail - 2)),
    glyphs: new Map(),
    dormant: Math.floor(Math.random() * 18),
  };
}

function tickRainColumn(
  col: RainColumn,
  height: number,
  maxTail: number,
): RainColumn {
  if (col.dormant > 0) {
    return { ...col, dormant: col.dormant - 1 };
  }
  const next = col.headY + col.speed;
  if (next > height + col.tail) {
    return makeRainColumn(height, maxTail);
  }
  const glyphs = new Map(col.glyphs);
  for (
    let y = Math.max(0, Math.ceil(col.headY));
    y <= Math.min(Math.floor(next), height - 1);
    y++
  ) {
    glyphs.set(y, pickGlyph());
  }
  // Glyphs in the tail occasionally mutate — gives the "live data" twitch.
  if (glyphs.size > 0 && Math.random() < 0.22) {
    const keys = [...glyphs.keys()];
    const k = keys[Math.floor(Math.random() * keys.length)];
    glyphs.set(k, pickGlyph());
  }
  return { ...col, headY: next, glyphs };
}

interface MatrixRainProps {
  width: number;
  height: number;
  /** Frame interval in ms. Defaults to 110. */
  tickMs?: number;
  /** Maximum tail length per column. Defaults to 7. */
  maxTail?: number;
  /** Wrap the rain in a rounded border. Defaults to true. */
  bordered?: boolean;
}

export const MatrixRain = ({
  width,
  height,
  tickMs = DEFAULT_TICK_MS,
  maxTail = DEFAULT_MAX_TAIL,
  bordered = true,
}: MatrixRainProps) => {
  const columnsRef = useRef<RainColumn[]>(
    Array.from({ length: width }, () => makeRainColumn(height, maxTail)),
  );
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      columnsRef.current = columnsRef.current.map((c) =>
        tickRainColumn(c, height, maxTail),
      );
      setTick((t) => t + 1);
    }, tickMs);
    return () => clearInterval(interval);
  }, [height, maxTail, tickMs]);

  const columns = columnsRef.current;
  const body = Array.from({ length: height }).map((_, y) => (
    <Box key={y}>
      {columns.map((col, x) => {
        const glyph = col.glyphs.get(y);
        if (!glyph) return <Text key={x}> </Text>;
        const dist = col.headY - y;
        if (dist < 0 || dist > col.tail) return <Text key={x}> </Text>;
        if (dist < 1) {
          return (
            <Text key={x} bold color={MATRIX_HEAD}>
              {glyph}
            </Text>
          );
        }
        if (dist < 2) {
          return (
            <Text key={x} color={MATRIX_BRIGHT}>
              {glyph}
            </Text>
          );
        }
        if (dist < col.tail * 0.55) {
          return (
            <Text key={x} color={MATRIX_MID}>
              {glyph}
            </Text>
          );
        }
        return (
          <Text key={x} color={MATRIX_FADE} dimColor>
            {glyph}
          </Text>
        );
      })}
    </Box>
  ));

  if (!bordered) {
    return <Box flexDirection="column">{body}</Box>;
  }
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={MATRIX_FADE}>
      {body}
    </Box>
  );
};
