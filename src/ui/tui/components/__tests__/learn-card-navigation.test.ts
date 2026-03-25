import {
  getLearnSectionIndex,
  getLearnSectionStartIndices,
} from '../learn-card-navigation.js';
import type { ContentBlock } from '../../primitives/content-types.js';

describe('learn-card navigation helpers', () => {
  it('uses clear blocks as section boundaries', () => {
    const blocks: ContentBlock[] = [
      'Welcome',
      { content: 'Intro detail' },
      { type: 'clear', pause: 1000 },
      { content: 'Events' },
      { type: 'lines', lines: [] },
      { type: 'clear' },
      { content: 'Insights' },
    ];

    expect(getLearnSectionStartIndices(blocks)).toEqual([0, 3, 6]);
  });

  it('skips consecutive clear blocks', () => {
    const blocks: ContentBlock[] = [
      'Welcome',
      { type: 'clear' },
      { type: 'clear' },
      { content: 'Events' },
    ];

    expect(getLearnSectionStartIndices(blocks)).toEqual([0, 3]);
  });

  it('maps a block index to the active section', () => {
    const sectionStarts = [0, 5, 10];

    expect(getLearnSectionIndex(sectionStarts, 0)).toBe(0);
    expect(getLearnSectionIndex(sectionStarts, 4)).toBe(0);
    expect(getLearnSectionIndex(sectionStarts, 5)).toBe(1);
    expect(getLearnSectionIndex(sectionStarts, 9)).toBe(1);
    expect(getLearnSectionIndex(sectionStarts, 12)).toBe(2);
  });
});
