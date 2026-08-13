/**
 * `complete_task` exists twice — a zod shape for the MCP/anthropic path and a
 * typebox mirror for pi — and the orchestrator runs on pi. When the two drifted,
 * `reportSection` was reachable only on the path nobody runs, so every task
 * asked for a report section it could not submit.
 */
import { describe, it, expect } from 'vitest';
import { HANDOFF_SHAPE_KEYS } from '../queue-tools';
import { PI_HANDOFF_PARAM_KEYS } from '../../../harness/pi/orchestrator-tools';

describe('complete_task handoff schema', () => {
  it('exposes the same fields on both harnesses', () => {
    expect([...PI_HANDOFF_PARAM_KEYS].sort()).toEqual(
      [...HANDOFF_SHAPE_KEYS].sort(),
    );
  });

  it.each(['reportSection', 'conflict', 'evidence', 'assumptions'])(
    'offers the optional field %s to pi agents',
    (field) => {
      expect(PI_HANDOFF_PARAM_KEYS).toContain(field);
    },
  );
});
