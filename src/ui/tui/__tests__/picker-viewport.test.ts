import { computePickerViewport } from '@ui/tui/primitives/PickerMenu';

/**
 * The framework picker's shape: 23 options, label-only rows, a filter row,
 * two columns (#1111). Its 12-row grid plus the intro screen's chrome needs
 * 28 terminal rows — anything shorter must page instead of overflowing.
 */
const FRAMEWORK_COUNT = 23;
const LABEL_ROW = 1;
const FILTER_CHROME = 1;

describe('computePickerViewport', () => {
  describe('two-column framework picker (#1111)', () => {
    it('keeps the grid on a tall terminal', () => {
      const vp = computePickerViewport(
        FRAMEWORK_COUNT,
        LABEL_ROW,
        FILTER_CHROME,
        2,
        0,
        50,
      );
      expect(vp.needsScroll).toBe(false);
      expect(vp.start).toBe(0);
      expect(vp.end).toBe(FRAMEWORK_COUNT);
    });

    it('keeps the grid at exactly 28 rows — the smallest healthy height', () => {
      const vp = computePickerViewport(
        FRAMEWORK_COUNT,
        LABEL_ROW,
        FILTER_CHROME,
        2,
        0,
        28,
      );
      expect(vp.needsScroll).toBe(false);
    });

    it('pages at 27 rows — the first height that used to corrupt', () => {
      const vp = computePickerViewport(
        FRAMEWORK_COUNT,
        LABEL_ROW,
        FILTER_CHROME,
        2,
        0,
        27,
      );
      expect(vp.needsScroll).toBe(true);
      // budget 11, minus the two "N more" indicator rows
      expect(vp.end - vp.start).toBe(9);
      expect(vp.hiddenBelow).toBe(FRAMEWORK_COUNT - 9);
    });

    it('shrinks the page with the terminal instead of overflowing', () => {
      const at20 = computePickerViewport(
        FRAMEWORK_COUNT,
        LABEL_ROW,
        FILTER_CHROME,
        2,
        0,
        20,
      );
      expect(at20.needsScroll).toBe(true);
      expect(at20.end - at20.start).toBe(2);

      // The floor: two indicator rows plus one option, never zero.
      const tiny = computePickerViewport(
        FRAMEWORK_COUNT,
        LABEL_ROW,
        FILTER_CHROME,
        2,
        0,
        10,
      );
      expect(tiny.needsScroll).toBe(true);
      expect(tiny.end - tiny.start).toBe(1);
    });
  });

  it('leaves a grid alone when it genuinely fits the height', () => {
    // 6 options in 2 columns is a 3-row grid — fine even at 20 rows.
    const vp = computePickerViewport(6, LABEL_ROW, 0, 2, 0, 20);
    expect(vp.needsScroll).toBe(false);
  });

  it('never pages lists shorter than the minimum count', () => {
    const vp = computePickerViewport(4, LABEL_ROW, 0, 1, 0, 10);
    expect(vp.needsScroll).toBe(false);
  });

  it('pages a long single-column list exactly as before', () => {
    const vp = computePickerViewport(23, LABEL_ROW, FILTER_CHROME, 1, 0, 50);
    expect(vp.needsScroll).toBe(true);
    expect(vp.end - vp.start).toBe(10); // MAX_LIST_ROWS 12 minus indicators
  });

  it('derives the visible page from the focused index', () => {
    const vp = computePickerViewport(23, LABEL_ROW, FILTER_CHROME, 2, 12, 27);
    // perPage 9: focused 12 sits on the second page.
    expect(vp.start).toBe(9);
    expect(vp.end).toBe(18);
    expect(vp.hiddenAbove).toBe(9);
    expect(vp.hiddenBelow).toBe(5);
  });

  it('wraps page stepping in both directions', () => {
    const vp = computePickerViewport(23, LABEL_ROW, FILTER_CHROME, 2, 0, 27);
    // perPage 9 → pages start at 0, 9, 18.
    expect(vp.pageStep(0, 1)).toBe(9);
    expect(vp.pageStep(18, 1)).toBe(0);
    expect(vp.pageStep(0, -1)).toBe(18);
  });
});
