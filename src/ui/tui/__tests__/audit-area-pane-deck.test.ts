/** Deck-walk coverage for AuditAreaPane (batch resolutions must not skip cards). */
import {
  deckTargetIndex,
  nextDeckIndex,
} from '@ui/tui/screens/audit/AuditAreaPane';
import type { AreaSlide } from '@ui/tui/screens/audit/slides/index';
import type { AuditCheck } from '@lib/programs/audit/types';
import { FEATURE_FLAGS_DOCTOR_SEED_CHECKS } from '@lib/programs/feature-flags-doctor/seed';

const DECK: AreaSlide[] = [
  'Feature Flags',
  'Feature Flags — Optimize',
  'Feature Flags — Delivery',
  'Feature Flags — Observability',
  'Workflow',
].map((area) => ({ area, intro: [area], docsUrl: '' }));

const withResolved = (resolvedAreas: string[]): AuditCheck[] =>
  FEATURE_FLAGS_DOCTOR_SEED_CHECKS.map((c) =>
    resolvedAreas.includes(c.area) ? { ...c, status: 'pass' as const } : c,
  );

describe('deckTargetIndex', () => {
  it('targets the slide of the first pending area', () => {
    expect(deckTargetIndex(DECK, FEATURE_FLAGS_DOCTOR_SEED_CHECKS)).toBe(0);
    expect(deckTargetIndex(DECK, withResolved(['Feature Flags']))).toBe(1);
  });

  it('targets past the end when every check is resolved', () => {
    const done = FEATURE_FLAGS_DOCTOR_SEED_CHECKS.map((c) => ({
      ...c,
      status: 'pass' as const,
    }));
    expect(deckTargetIndex(DECK, done)).toBe(DECK.length);
  });

  it('returns -1 for a head area with no registered slide', () => {
    const checks: AuditCheck[] = [
      { id: 'x', area: 'Mystery Area', label: 'x', status: 'pending' },
    ];
    expect(deckTargetIndex(DECK, checks)).toBe(-1);
  });
});

describe('nextDeckIndex walk', () => {
  it('replays the logged batch without skipping Delivery or Observability', () => {
    const afterBatch = withResolved([
      'Feature Flags',
      'Feature Flags — Optimize',
      'Feature Flags — Delivery',
      'Feature Flags — Observability',
    ]);
    const target = deckTargetIndex(DECK, afterBatch);
    expect(target).toBe(4); // head pending row is now Workflow

    const visited: number[] = [];
    let displayed = 1; // Optimize card was up when the batch landed
    while (displayed !== nextDeckIndex(displayed, target)) {
      displayed = nextDeckIndex(displayed, target);
      visited.push(displayed);
    }
    // Delivery (2) and Observability (3) each get a full dwell on the way.
    expect(visited).toEqual([2, 3, 4]);
  });

  it('walks one card at a time toward a finished run, then off the deck', () => {
    expect(nextDeckIndex(3, DECK.length)).toBe(4);
    expect(nextDeckIndex(4, DECK.length)).toBe(5); // deck played out
  });

  it('snaps backward when a sweep row re-opens an earlier area', () => {
    expect(nextDeckIndex(3, 1)).toBe(1);
  });

  it('holds position on an unknown-area target and when caught up', () => {
    expect(nextDeckIndex(2, -1)).toBe(2);
    expect(nextDeckIndex(2, 2)).toBe(2);
  });
});
