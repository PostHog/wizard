/**
 * `complete_task` exists twice — a zod shape for the MCP/anthropic path and a
 * typebox mirror for pi — and the orchestrator runs on pi. When the two drifted,
 * `reportSection` was reachable only on the path nobody runs, so every task
 * asked for a report section it could not submit.
 */
import { describe, it, expect } from 'vitest';
import { HANDOFF_FIELDS, HANDOFF_SHAPE_KEYS } from '../queue-tools';
import { PI_HANDOFF_PARAM_KEYS } from '../../../harness/pi/orchestrator-tools';

describe('complete_task handoff schema', () => {
  it('exposes the same fields on both harnesses', () => {
    expect([...PI_HANDOFF_PARAM_KEYS].sort()).toEqual(
      [...HANDOFF_SHAPE_KEYS].sort(),
    );
  });

  // The check above only holds the two schemas level with *each other*, so both
  // could drop the same field and still agree. `HANDOFF_FIELDS` is the anchor:
  // tsc already ties it to `TaskHandoff`, so tying the schemas to it closes the
  // loop — a field the interface declares can't end up described but unsendable.
  it.each([
    ['zod', HANDOFF_SHAPE_KEYS],
    ['pi', PI_HANDOFF_PARAM_KEYS],
  ])('offers every described field on the %s schema', (_name, keys) => {
    expect([...keys].sort()).toEqual(Object.keys(HANDOFF_FIELDS).sort());
  });

  it.each(['reportSection', 'conflict', 'evidence', 'assumptions'])(
    'offers the optional field %s to pi agents',
    (field) => {
      expect(PI_HANDOFF_PARAM_KEYS).toContain(field);
    },
  );
});
