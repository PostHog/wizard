/**
 * Bounds-safe ASCII grid shared by the phase visuals.
 *
 * Every visual builds a width×height character grid and then wraps it in
 * <Panel>. Historically each visual did its own `grid[y][x] = ch` writes, and
 * one that miscomputed a coordinate on a short or narrow panel would index an
 * undefined row (`grid[-1][x]`) and crash the *entire* TUI — see the Tumblers
 * negative-pin-row bug that took the Visualizer tab down.
 *
 * Routing every write through `plot` makes an out-of-bounds coordinate a
 * silent no-op, so a geometry bug degrades to a cosmetic glitch instead of a
 * crash. New visuals should build their grid with `createGrid` and write to it
 * with `plot` / `writeText` rather than indexing rows directly.
 */

export type Grid = string[][];

/** Allocate a blank `width`×`height` grid of spaces. Degenerate or negative
 *  dimensions collapse to an empty grid rather than throwing. */
export const createGrid = (width: number, height: number): Grid => {
  const h = Math.max(0, Math.floor(height));
  const w = Math.max(0, Math.floor(width));
  return Array.from({ length: h }, () => new Array<string>(w).fill(' '));
};

/** Write a single cell, ignoring any coordinate outside the grid (including
 *  negative or fractional ones). This is the one guard the visuals rely on to
 *  never crash regardless of panel size. */
export const plot = (grid: Grid, x: number, y: number, ch: string): void => {
  const row = grid[y];
  if (row === undefined) return;
  if (x < 0 || x >= row.length) return;
  row[x] = ch;
};

/** Write `text` left-to-right starting at (x, y). Clips at the grid edge and,
 *  when given, after `maxW` characters. Off-grid cells are dropped by `plot`. */
export const writeText = (
  grid: Grid,
  x: number,
  y: number,
  text: string,
  maxW?: number,
): void => {
  const limit = maxW === undefined ? text.length : Math.max(0, maxW);
  for (let i = 0; i < text.length && i < limit; i++) {
    plot(grid, x + i, y, text[i]);
  }
};
