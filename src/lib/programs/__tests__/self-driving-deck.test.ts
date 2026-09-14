import type { ReactElement, ReactNode } from 'react';
import { PROGRAM_REGISTRY } from '@lib/programs/program-registry';
import { WizardStore } from '@ui/tui/store';

const PANE_WIDTH_80COL = 37;
const LEGACY_FIXED_LINE_WIDTH_BY_PROGRAM = new Map([
  ['posthog-integration', 45],
  ['migration', 53],
]);
const LEGACY_PROSE_ROWS_BY_PROGRAM = new Map([
  ['error-tracking-upload-source-maps', 6],
]);

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  const element = node as ReactElement<{ children?: ReactNode }>;
  return textOf(element.props?.children);
}

const baseStore = new WizardStore();
const decks = PROGRAM_REGISTRY.flatMap((program) => {
  if (!program.getContentBlocks) return [];
  const store = program.skillId
    ? withSessionOverride(baseStore, { skillId: program.skillId })
    : baseStore;
  return [
    {
      id: program.id,
      blocks: program.getContentBlocks(store),
    },
  ];
});

function withSessionOverride(
  store: WizardStore,
  patch: Partial<WizardStore['session']>,
): WizardStore {
  const stub = Object.create(Object.getPrototypeOf(store)) as WizardStore;
  Object.assign(stub, store);
  Object.defineProperty(stub, 'session', {
    value: { ...store.session, ...patch },
    writable: false,
    configurable: true,
  });
  return stub;
}

describe('program learn decks', () => {
  it('has blocks in every registered deck', () => {
    const emptyDecks = decks
      .filter((deck) => deck.blocks.length === 0)
      .map((deck) => deck.id);
    expect(emptyDecks).toEqual([]);
  });

  it('keeps every fixed-layout line within its width ceiling', () => {
    const wide: string[] = [];
    for (const deck of decks) {
      const maxLineWidth =
        LEGACY_FIXED_LINE_WIDTH_BY_PROGRAM.get(deck.id) ?? PANE_WIDTH_80COL;
      for (const block of deck.blocks) {
        if (
          typeof block !== 'object' ||
          !('type' in block) ||
          block.type !== 'lines'
        ) {
          continue;
        }
        for (const line of block.lines) {
          for (const physicalLine of textOf(line).split('\n')) {
            if ([...physicalLine].length > maxLineWidth) {
              wide.push(`${deck.id}: ${physicalLine}`);
            }
          }
        }
      }
    }
    expect(wide).toEqual([]);
  });

  it('keeps every prose beat short enough to never fill the pane', () => {
    const long: string[] = [];
    for (const deck of decks) {
      const maxProseRows = LEGACY_PROSE_ROWS_BY_PROGRAM.get(deck.id) ?? 4;
      for (const block of deck.blocks) {
        if (typeof block !== 'object' || !('content' in block)) continue;
        if (typeof block.content !== 'string') continue;
        if (Math.ceil(block.content.length / PANE_WIDTH_80COL) > maxProseRows) {
          long.push(`${deck.id}: ${block.content}`);
        }
      }
    }
    expect(long).toEqual([]);
  });

  it('keeps implementation jargon out of the cull deck', () => {
    const cullDeck = decks.find((deck) => deck.id === 'cull-feature-flags');
    expect(cullDeck).toBeDefined();
    const forbiddenContent = cullDeck?.blocks.filter((block) => {
      if (typeof block === 'string') {
        return /winning branch|grep|bucket/i.test(block);
      }
      if (!('content' in block) || typeof block.content !== 'string') {
        return false;
      }
      return /winning branch|grep|bucket/i.test(block.content);
    });
    expect(forbiddenContent).toEqual([]);
  });
});
