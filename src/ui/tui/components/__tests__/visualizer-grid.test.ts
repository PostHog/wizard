import {
  createGrid,
  plot,
  writeText,
} from '@ui/tui/components/visualizer/grid';

/**
 * These tests pin the root-cause guarantee behind the Visualizer tab crash:
 * a visual that miscomputes a coordinate on a short/narrow panel must never
 * index an undefined row and take down the TUI. Every phase visual now routes
 * its writes through `plot`/`writeText`, so exercising those at and beyond the
 * grid edge — including the exact negative-row case that crashed Tumblers —
 * covers the whole class of bug.
 */

describe('createGrid', () => {
  it('allocates a width×height grid of spaces', () => {
    const grid = createGrid(3, 2);
    expect(grid).toHaveLength(2);
    expect(grid.every((row) => row.length === 3)).toBe(true);
    expect(grid.flat().every((c) => c === ' ')).toBe(true);
  });

  it('collapses degenerate or negative dimensions to an empty grid', () => {
    expect(createGrid(0, 0)).toEqual([]);
    expect(createGrid(-5, -5)).toEqual([]);
    expect(createGrid(-1, 3)).toEqual([[], [], []]);
  });

  it('floors fractional dimensions', () => {
    const grid = createGrid(2.9, 1.9);
    expect(grid).toHaveLength(1);
    expect(grid[0]).toHaveLength(2);
  });
});

describe('plot', () => {
  it('writes an in-bounds cell', () => {
    const grid = createGrid(3, 3);
    plot(grid, 1, 2, '█');
    expect(grid[2][1]).toBe('█');
  });

  it('is a no-op for the exact negative-row case that crashed Tumblers', () => {
    const grid = createGrid(2, 2);
    // pinX = 12 landed at a negative row -> grid[-1][12] used to throw
    // "Cannot set properties of undefined (setting '12')".
    expect(() => plot(grid, 12, -1, '█')).not.toThrow();
    expect(grid).toEqual([
      [' ', ' '],
      [' ', ' '],
    ]);
  });

  it('drops every out-of-bounds coordinate without throwing', () => {
    const grid = createGrid(4, 4);
    const before = JSON.stringify(grid);
    for (let y = -3; y < 8; y++) {
      for (let x = -3; x < 8; x++) {
        if (x >= 0 && x < 4 && y >= 0 && y < 4) continue; // skip in-bounds
        expect(() => plot(grid, x, y, '#')).not.toThrow();
      }
    }
    // Nothing out-of-bounds should have leaked into the grid.
    expect(JSON.stringify(grid)).toBe(before);
  });

  it('never throws across a matrix of tiny grids and wild coordinates', () => {
    for (let h = 0; h <= 6; h++) {
      for (let w = 0; w <= 6; w++) {
        const grid = createGrid(w, h);
        for (let y = -4; y <= h + 4; y++) {
          for (let x = -4; x <= w + 4; x++) {
            expect(() => plot(grid, x, y, '*')).not.toThrow();
          }
        }
      }
    }
  });
});

describe('writeText', () => {
  it('writes left-to-right and clips at the right edge', () => {
    const grid = createGrid(4, 1);
    writeText(grid, 1, 0, 'HELLO');
    expect(grid[0].join('')).toBe(' HEL');
  });

  it('respects an explicit maxW', () => {
    const grid = createGrid(10, 1);
    writeText(grid, 0, 0, 'HELLO', 2);
    expect(grid[0].join('')).toBe('HE        ');
  });

  it('does not throw when the start point is off-grid', () => {
    const grid = createGrid(3, 3);
    expect(() => writeText(grid, -2, -1, 'abc')).not.toThrow();
    expect(() => writeText(grid, 10, 10, 'abc')).not.toThrow();
  });

  it('clips a string that starts on-grid and runs off the edge', () => {
    const grid = createGrid(3, 1);
    writeText(grid, 2, 0, 'XYZ');
    expect(grid[0].join('')).toBe('  X');
  });
});
