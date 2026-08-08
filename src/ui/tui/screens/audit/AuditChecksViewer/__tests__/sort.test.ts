import { describe, expect, it } from 'vitest';
import type { AuditCheck } from '@lib/programs/audit/types';
import { groupChecksByArea, sortChecks } from '../sort.js';

/**
 * Regression for PostHog/wizard#736 — audit findings rotate between runs
 * because the viewer's sort had no tiebreaker for checks that shared a
 * (status, area) pair. The skill writes the ledger in whatever order it
 * happens to resolve checks, so identical findings rendered in different
 * positions on different runs. The contract here: render order is a pure
 * function of the ledger contents, never of the write order.
 */
describe('audit check ordering — deterministic regardless of input order', () => {
  const a: AuditCheck = {
    id: 'capture-event-names-static',
    area: 'Event Capture',
    label: 'Event names are static',
    status: 'error',
  };
  const b: AuditCheck = {
    id: 'capture-uses-proxy',
    area: 'Event Capture',
    label: 'Captures route through a reverse proxy',
    status: 'error',
  };

  it('sortChecks orders same-status, same-area checks by id', () => {
    const forward = sortChecks([a, b]).map((c) => c.id);
    const reversed = sortChecks([b, a]).map((c) => c.id);
    expect(forward).toEqual(reversed);
    expect(forward).toEqual([
      'capture-event-names-static',
      'capture-uses-proxy',
    ]);
  });

  it('groupChecksByArea orders within-area same-status checks by id', () => {
    const eventCapture = (checks: AuditCheck[]) => {
      const group = groupChecksByArea(checks).find(
        (g) => g.area === 'Event Capture',
      );
      if (!group) throw new Error('Event Capture group missing');
      return group.checks.map((c) => c.id);
    };

    const forward = eventCapture([a, b]);
    const reversed = eventCapture([b, a]);
    expect(forward).toEqual(reversed);
    expect(forward).toEqual([
      'capture-event-names-static',
      'capture-uses-proxy',
    ]);
  });
});
