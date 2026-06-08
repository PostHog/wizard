/**
 * DashboardGrid — dashboards phase.
 *
 * 2×2 grid of mini-charts to evoke a real PostHog dashboard. When the area
 * is too small, the layout collapses to 1×2 or 1×1 so something always
 * renders.
 */

import { Box, Text } from 'ink';
import { useTick } from '@ui/tui/hooks/useTick';
import { MATRIX_FADE, Panel, type VisualProps } from './panel';

type TileKind = 'bars' | 'line' | 'gauge' | 'pulse';

const DASHBOARD_TILES: Array<{ title: string; kind: TileKind }> = [
  { title: 'Visitors', kind: 'bars' },
  { title: 'Sessions', kind: 'line' },
  { title: 'Revenue', kind: 'gauge' },
  { title: 'Errors', kind: 'pulse' },
];

const SPARK_GLYPHS = '▁▂▃▄▅▆▇█';

export const DashboardGrid = ({ width, height }: VisualProps) => {
  const tick = useTick(220);
  const grid: string[][] = Array.from({ length: height }, () =>
    new Array(width).fill(' '),
  );

  // Collapse to fewer cells when there isn't room for a real 2×2.
  const cols = width >= 22 ? 2 : 1;
  const rows = height >= 7 ? 2 : 1;
  const vSplit = cols === 2 ? Math.floor(width / 2) : -1;
  const hSplit = rows === 2 ? Math.floor(height / 2) : -1;

  if (vSplit >= 0) {
    for (let y = 0; y < height; y++) grid[y][vSplit] = '│';
  }
  if (hSplit >= 0) {
    for (let x = 0; x < width; x++) grid[hSplit][x] = '─';
    if (vSplit >= 0) grid[hSplit][vSplit] = '┼';
  }

  const writeText = (x0: number, y0: number, maxW: number, text: string) => {
    if (y0 < 0 || y0 >= height) return;
    const slice = text.slice(0, Math.max(0, maxW));
    for (let i = 0; i < slice.length; i++) {
      if (x0 + i >= 0 && x0 + i < width) grid[y0][x0 + i] = slice[i];
    }
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tile = DASHBOARD_TILES[r * cols + c];
      const tileX = c === 0 ? 0 : vSplit + 1;
      const tileY = r === 0 ? 0 : hSplit + 1;
      const tileW =
        cols === 2 ? (c === 0 ? vSplit : width - vSplit - 1) : width;
      const tileH =
        rows === 2 ? (r === 0 ? hSplit : height - hSplit - 1) : height;

      const innerX = tileX;
      const innerW = Math.max(1, tileW);
      const titleY = tileY;
      const valueY = tileY + tileH - 1;
      const chartY0 = tileY + 1;
      const chartY1 = Math.max(chartY0, valueY - 1);
      const chartH = Math.max(1, chartY1 - chartY0 + 1);
      const seed = (r * cols + c) * 13;

      writeText(innerX, titleY, innerW, tile.title);
      renderTile(
        grid,
        tile.kind,
        innerX,
        chartY0,
        innerW,
        chartH,
        tick,
        seed,
        width,
      );
      writeText(innerX, valueY, innerW, tileValue(tile.kind, tick, seed));
    }
  }

  return (
    <Panel>
      {grid.map((row, y) => (
        <Box key={y}>
          {row.map((ch, x) => {
            if (ch === ' ') return <Text key={x}> </Text>;
            if (ch === '│' || ch === '─' || ch === '┼') {
              return (
                <Text key={x} color={MATRIX_FADE} dimColor>
                  {ch}
                </Text>
              );
            }
            if (SPARK_GLYPHS.includes(ch) || ch === '█') {
              return (
                <Text key={x} color={'#22D622'}>
                  {ch}
                </Text>
              );
            }
            if (ch === '●' || ch === '∙' || ch === '·') {
              const color =
                ch === '●' ? '#E6FFE6' : ch === '∙' ? '#7CFF7C' : '#22D622';
              return (
                <Text key={x} bold={ch === '●'} color={color}>
                  {ch}
                </Text>
              );
            }
            if (ch === '▲' || ch === '▼') {
              return (
                <Text key={x} bold color={ch === '▲' ? '#7CFF7C' : '#D63B22'}>
                  {ch}
                </Text>
              );
            }
            return (
              <Text key={x} color={'#7CFF7C'}>
                {ch}
              </Text>
            );
          })}
        </Box>
      ))}
    </Panel>
  );
};

function renderTile(
  grid: string[][],
  kind: TileKind,
  x0: number,
  y0: number,
  w: number,
  h: number,
  tick: number,
  seed: number,
  gridW: number,
): void {
  const set = (x: number, y: number, ch: string) => {
    if (y < 0 || y >= grid.length) return;
    if (x < 0 || x >= gridW) return;
    grid[y][x] = ch;
  };

  if (kind === 'bars') {
    // Vertical bars driven by a slow per-column sine. Most tile feels
    // "spectrum analyzer"-y.
    for (let i = 0; i < w; i++) {
      const t = tick * 0.18 + (i + seed) * 0.6;
      const level = 0.55 + 0.35 * Math.sin(t) + 0.1 * Math.sin(t * 2.7);
      const filled = Math.max(0, Math.min(h, Math.round(level * h)));
      for (let j = 0; j < filled; j++) {
        set(x0 + i, y0 + h - 1 - j, '█');
      }
      if (filled > 0 && filled < h) {
        const frac = level * h - Math.floor(level * h);
        const glyph =
          SPARK_GLYPHS[Math.floor(frac * (SPARK_GLYPHS.length - 1))];
        set(x0 + i, y0 + h - filled, glyph);
      }
    }
  } else if (kind === 'line') {
    // Ascending trend with a single deterministic spike.
    const spikeAt = (((tick / 12) | 0) + seed) % Math.max(1, w);
    for (let i = 0; i < w; i++) {
      const norm = i / Math.max(1, w - 1);
      const base = h - 1 - norm * (h - 1);
      let yf = base + 0.6 * Math.sin(i * 0.7 + seed + tick * 0.05);
      if (i === spikeAt) yf = Math.max(0, base - 1.5);
      const y = Math.max(0, Math.min(h - 1, Math.round(yf)));
      const dist = Math.abs(i - (w - 1));
      const ch = dist === 0 ? '●' : dist < 3 ? '∙' : '·';
      set(x0 + i, y0 + y, ch);
    }
  } else if (kind === 'gauge') {
    // Progress bar that fills, drains, refills. Suggests a goal/target.
    const cycle = (tick + seed) % 40;
    const pct = cycle < 30 ? cycle / 30 : 1 - (cycle - 30) / 10;
    const midY = y0 + Math.floor(h / 2);
    const filled = Math.max(0, Math.min(w, Math.round(pct * w)));
    for (let i = 0; i < w; i++) {
      set(x0 + i, midY, i < filled ? '█' : '·');
    }
  } else if (kind === 'pulse') {
    // Mostly quiet bars with occasional spikes — like an error rate that
    // mostly hovers low.
    for (let i = 0; i < w; i++) {
      const t = (i + seed + Math.floor(tick / 3)) % 17;
      let level: number;
      if (t === 0) level = 0.9;
      else if (t === 1 || t === 16) level = 0.5;
      else level = 0.12 + 0.06 * Math.sin((i + tick) * 0.5);
      const filled = Math.max(1, Math.min(h, Math.round(level * h)));
      for (let j = 0; j < filled; j++) {
        set(x0 + i, y0 + h - 1 - j, '█');
      }
    }
  }
}

function tileValue(kind: TileKind, tick: number, seed: number): string {
  const wave = 0.5 + 0.5 * Math.sin(tick * 0.05 + seed);
  if (kind === 'bars') {
    const n = Math.round(8000 + wave * 6000);
    return `${(n / 1000).toFixed(1)}k ▲`;
  }
  if (kind === 'line') {
    const n = 2 + wave * 4;
    return `${n.toFixed(1)}% ▲`;
  }
  if (kind === 'gauge') {
    const n = Math.round(20 + wave * 60);
    return `$${n}k`;
  }
  // pulse
  const n = Math.round(1 + wave * 5);
  return `${n} ▼`;
}
