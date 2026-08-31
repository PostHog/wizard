/**
 * The viewport gate is the one thing that has to render correctly in a
 * terminal too small for everything else — so it wraps its own text and never
 * emits a line wider than the window it is complaining about.
 */

import {
  isViewportTooSmall,
  viewportNoticeLines,
  viewportSizeLine,
  MIN_VIEWPORT_COLUMNS,
  MIN_VIEWPORT_ROWS,
  VIEWPORT_TOO_SMALL_MESSAGE,
} from '@ui/tui/primitives/ViewportTooSmall';

describe('isViewportTooSmall', () => {
  it('passes a terminal at exactly the minimum', () => {
    expect(isViewportTooSmall(MIN_VIEWPORT_COLUMNS, MIN_VIEWPORT_ROWS)).toBe(
      false,
    );
  });

  it('fails on either axis alone', () => {
    expect(
      isViewportTooSmall(MIN_VIEWPORT_COLUMNS - 1, MIN_VIEWPORT_ROWS),
    ).toBe(true);
    expect(
      isViewportTooSmall(MIN_VIEWPORT_COLUMNS, MIN_VIEWPORT_ROWS - 1),
    ).toBe(true);
  });

  it('passes a large terminal', () => {
    expect(isViewportTooSmall(200, 60)).toBe(false);
  });

  it('rejects the heights that garble the framework picker (#1111)', () => {
    // Measured against the real TUI in a PTY: 27 rows and below overprints the
    // intro lines and drops framework options; 28 renders cleanly.
    for (const rows of [24, 26, 27]) {
      expect(isViewportTooSmall(110, rows)).toBe(true);
    }
    expect(isViewportTooSmall(110, 28)).toBe(false);
    expect(isViewportTooSmall(80, 28)).toBe(false);
  });
});

describe('viewport notice text', () => {
  it('keeps the copy the product asked for in one place', () => {
    expect(VIEWPORT_TOO_SMALL_MESSAGE).toBe(
      'Hey, can you make this terminal window a little bigger? The interactive Wizard needs more room to display properly.',
    );
  });

  it('wraps both lines within the terminal width instead of overflowing', () => {
    for (const columns of [20, 34, 52, 79]) {
      const lines = [
        ...viewportNoticeLines(VIEWPORT_TOO_SMALL_MESSAGE, columns),
        ...viewportNoticeLines(viewportSizeLine(columns, 10), columns),
      ];
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(columns);
      }
    }
  });

  it('loses no words to the wrap', () => {
    expect(viewportNoticeLines(VIEWPORT_TOO_SMALL_MESSAGE, 34).join(' ')).toBe(
      VIEWPORT_TOO_SMALL_MESSAGE,
    );
  });

  it('reports the current size against the required one', () => {
    expect(viewportSizeLine(40, 12)).toBe(
      `Currently 40×12, needs at least ${MIN_VIEWPORT_COLUMNS}×${MIN_VIEWPORT_ROWS}.`,
    );
  });
});
