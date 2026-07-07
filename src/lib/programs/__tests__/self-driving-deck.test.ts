/**
 * Layout guards for the self-driving learn deck. The LearnCard pane is
 * ~37 chars wide at an 80-column terminal (the narrowest split view; below
 * 80 cols the pane is dropped entirely). Prose blocks word-wrap fine, but
 * fixed-layout `lines` blocks (diagrams, lists) must fit unwrapped, and no
 * scene should stack more prose than the pane can show at once.
 */

import type { ReactNode, ReactElement } from 'react';
import type { WizardStore } from '@ui/tui/store';
import { getContentBlocks } from '@lib/programs/self-driving/content/index';

/** paneWidth in LearnCard at 80 cols: (min(120, 80) - 2) / 2 - 2 */
const PANE_WIDTH_80COL = 37;

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  const el = node as ReactElement<{ children?: ReactNode }>;
  return textOf(el.props?.children);
}

const storeWith = (integrate: boolean | null): WizardStore =>
  ({ session: { integrate } } as unknown as WizardStore);

describe.each([
  ['fresh path', storeWith(null)],
  ['integrate path', storeWith(true)],
])('self-driving learn deck (%s)', (_label, store) => {
  const blocks = getContentBlocks(store);

  it('has blocks', () => {
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('keeps every fixed-layout line within the 80-col pane', () => {
    const wide: string[] = [];
    for (const b of blocks) {
      if (typeof b !== 'object' || !('type' in b) || b.type !== 'lines') {
        continue;
      }
      for (const line of b.lines) {
        const text = textOf(line);
        if ([...text].length > PANE_WIDTH_80COL) wide.push(text);
      }
    }
    expect(wide).toEqual([]);
  });

  it('keeps every prose beat short enough to never fill the pane', () => {
    const long: string[] = [];
    for (const b of blocks) {
      if (typeof b !== 'object' || !('content' in b)) continue;
      if (typeof b.content !== 'string') continue;
      if (Math.ceil(b.content.length / PANE_WIDTH_80COL) > 4) {
        long.push(b.content);
      }
    }
    expect(long).toEqual([]);
  });
});

it('skips the platform-story scene on the integrate path', () => {
  const fresh = getContentBlocks(storeWith(null));
  const integrate = getContentBlocks(storeWith(true));
  expect(integrate.length).toBeLessThan(fresh.length);

  const texts = (bs: ReturnType<typeof getContentBlocks>) =>
    bs
      .filter(
        (b): b is { content: string } =>
          typeof b === 'object' &&
          'content' in b &&
          typeof b.content === 'string',
      )
      .map((b) => b.content);
  expect(texts(fresh).join(' ')).toContain('one data layer');
  expect(texts(integrate).join(' ')).not.toContain('one data layer');
});
