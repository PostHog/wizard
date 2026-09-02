/**
 * Layout guards for the feature-flags learn deck. The LearnCard pane is
 * ~37 chars wide at an 80-column terminal (the narrowest split view; below
 * 80 cols the pane is dropped entirely). Prose blocks word-wrap fine, but
 * fixed-layout `lines` blocks (diagrams, lists) must fit unwrapped, and no
 * scene should stack more prose than the pane can show at once.
 */

import type { ReactNode, ReactElement } from 'react';
import { getContentBlocks } from '@lib/programs/feature-flags/content/index';
import { FEATURE_FLAGS_TIPS } from '@lib/programs/feature-flags/content/tips';
import { FLAG_SPIKE } from '@lib/programs/feature-flags/content/set-pieces';
import { featureFlagsConfig } from '@lib/programs/feature-flags/index';

/** paneWidth in LearnCard at 80 cols: (min(120, 80) - 2) / 2 - 2 */
const PANE_WIDTH_80COL = 37;

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  const el = node as ReactElement<{ children?: ReactNode }>;
  return textOf(el.props?.children);
}

function allDeckText(blocks: ReturnType<typeof getContentBlocks>): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if (typeof b === 'string') {
      out.push(b);
      continue;
    }
    if (typeof b !== 'object') continue;
    if ('type' in b && b.type === 'lines') {
      for (const line of b.lines) out.push(textOf(line));
      continue;
    }
    if ('content' in b && typeof b.content === 'string') {
      out.push(b.content);
    }
  }
  return out;
}

describe('feature-flags learn deck', () => {
  const blocks = getContentBlocks();

  it('has more than the generic three-block skill deck', () => {
    expect(blocks.length).toBeGreaterThan(10);
  });

  it('is wired onto the program config, not the generic skill deck', () => {
    expect(featureFlagsConfig.getContentBlocks).toBe(getContentBlocks);
    expect(featureFlagsConfig.getTips?.()).toEqual(FEATURE_FLAGS_TIPS);
  });

  it('greets by first name when the session has one', () => {
    const named = getContentBlocks({
      session: { apiUser: { first_name: 'Filip' } },
    } as Parameters<typeof getContentBlocks>[0]);
    const first = named[0];
    expect(
      typeof first === 'object' && 'content' in first ? first.content : '',
    ).toBe('Welcome, Filip.');
  });

  it('keeps the /flags spike chart as one connected line', () => {
    const curves = FLAG_SPIKE.lines
      .map(textOf)
      .filter((t) => t.includes('╭') || t.includes('╯'));
    expect(curves.length).toBeGreaterThan(2);
    for (let i = 1; i < curves.length; i++) {
      const prevStart = [...curves[i - 1]].indexOf('╭');
      const thisEnd = [...curves[i]].indexOf('╯');
      expect(thisEnd).toBe(prevStart);
    }
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

  it('tells the kill-switch story, not a syllabus', () => {
    const text = allDeckText(blocks).join('\n').toLowerCase();
    expect(text).toContain("i'm putting a kill switch on this app");
    expect(text).toContain('but...');
    expect(text).toContain('this request inflates the bill');
    expect(text).toContain('/flags');
    expect(text).toContain('evaluateflags');
    expect(text).toContain('bootstrap');
    expect(text).toContain('boolean');
    expect(text).toContain('multivariate');
    expect(text).toContain('skip is first');
    expect(text).toContain('0%');
    expect(text).toContain('until you raise it, nobody sees a thing');
    expect(text).toContain('welcome back');
    expect(text).toContain('[ save ]');
    expect(text).not.toContain('this is not the default wizard');
  });

  it('does not use em-dashes or en-dashes in string copy', () => {
    const hits = allDeckText(blocks).filter((s) => /[\u2013\u2014]/.test(s));
    expect(hits).toEqual([]);
    const tipHits = FEATURE_FLAGS_TIPS.flatMap((t) => [
      t.title,
      t.description,
    ]).filter((s) => /[\u2013\u2014]/.test(s));
    expect(tipHits).toEqual([]);
  });
});
