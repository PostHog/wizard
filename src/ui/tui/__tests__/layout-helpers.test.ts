import {
  estimateBlockHeight,
  computeVisibleRange,
} from '../primitives/layout-helpers.js';
import type { ContentBlock } from '../primitives/content-types.js';

describe('estimateBlockHeight', () => {
  it('counts wrapped lines for a short string that fits in one line', () => {
    // "Hello" at width 40 → 1 line + 1 margin = 2
    expect(estimateBlockHeight('Hello', 40)).toBe(2);
  });

  it('wraps a long paragraph into multiple lines', () => {
    // 10 words × ~5 chars + spaces ≈ 59 chars → 2 lines at width 40
    const text = 'one two three four five six seven eight nine ten';
    const height = estimateBlockHeight(text, 40);
    expect(height).toBe(3); // 2 wrapped lines + 1 margin
  });

  it('handles lines block by counting lines array length', () => {
    const block: ContentBlock = {
      type: 'lines',
      lines: [null, null, null, null, null],
    };
    // 5 lines + 1 margin = 6
    expect(estimateBlockHeight(block, 40)).toBe(6);
  });

  it('returns a fixed estimate for node blocks', () => {
    const block: ContentBlock = { content: null };
    const height = estimateBlockHeight(block, 40);
    expect(height).toBeGreaterThanOrEqual(2);
    expect(height).toBeLessThanOrEqual(6);
  });
});

describe('computeVisibleRange', () => {
  const blocks: ContentBlock[] = [
    'Short block one.',
    'Short block two.',
    'Short block three.',
    'Short block four.',
    'Short block five.',
  ];

  it('shows all blocks when they fit within maxHeight', () => {
    const [start, end] = computeVisibleRange(blocks, 4, 50, 100);
    expect(start).toBe(0);
    expect(end).toBe(4);
  });

  it('evicts earlier blocks when content exceeds maxHeight', () => {
    // Each short block ≈ 2 rows. 5 blocks = 10 rows. maxHeight = 6 → must evict.
    const [start, end] = computeVisibleRange(blocks, 4, 50, 6);
    expect(start).toBeGreaterThan(0);
    expect(end).toBe(4);
    // Visible blocks should fit within maxHeight
    let totalHeight = 0;
    for (let i = start; i <= end; i++) {
      totalHeight += estimateBlockHeight(blocks[i], 50);
    }
    expect(totalHeight).toBeLessThanOrEqual(6);
  });

  it('always includes the active block even if it alone exceeds maxHeight', () => {
    const bigBlocks: ContentBlock[] = ['A '.repeat(200)];
    const [start, end] = computeVisibleRange(bigBlocks, 0, 40, 4);
    expect(start).toBe(0);
    expect(end).toBe(0);
  });

  it('eviction is monotonic — start never decreases as activeIdx advances', () => {
    let prevStart = 0;
    for (let active = 0; active < blocks.length; active++) {
      const [start] = computeVisibleRange(blocks, active, 50, 6);
      expect(start).toBeGreaterThanOrEqual(prevStart);
      prevStart = start;
    }
  });
});
