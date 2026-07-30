/**
 * Layout guard for the narrowest LearnCard split view. At 80 terminal columns,
 * the feature-flags deck receives a 37-character pane.
 */

import type { ReactElement, ReactNode } from 'react';
import { getContentBlocks } from '@lib/programs/feature-flags/content/index';

const PANE_WIDTH_80COL = 37;

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  const element = node as ReactElement<{ children?: ReactNode }>;
  return textOf(element.props?.children);
}

describe('feature-flags learn deck', () => {
  it('keeps fixed-layout lines within the 80-column pane', () => {
    const wideLines: string[] = [];

    for (const block of getContentBlocks()) {
      if (
        typeof block !== 'object' ||
        !('type' in block) ||
        block.type !== 'lines'
      ) {
        continue;
      }

      for (const line of block.lines) {
        const text = textOf(line);
        if ([...text].length > PANE_WIDTH_80COL) wideLines.push(text);
      }
    }

    expect(wideLines).toEqual([]);
  });
});
