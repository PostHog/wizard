/**
 * `complete_task` exists twice — a zod shape for the MCP/anthropic path and a
 * typebox mirror for pi — and the orchestrator runs on pi. When the two drifted,
 * `reportSection` was reachable only on the path nobody runs, so every task
 * asked for a report section it could not submit.
 */
import { describe, it, expect } from 'vitest';
import {
  COMPLETE_TASK_DESCRIPTION,
  HANDOFF_FIELDS,
  HANDOFF_SHAPE_KEYS,
  type OrchestratorToolsContext,
} from '../queue-tools';
import {
  createPiOrchestratorTools,
  PI_HANDOFF_PARAM_KEYS,
} from '../../../harness/pi/orchestrator-tools';

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

describe('complete_task description', () => {
  const piCompleteTask = () => {
    const ctx = { validTypes: [] } as unknown as OrchestratorToolsContext;
    const tool = createPiOrchestratorTools(ctx).find(
      (t) => (t as unknown as { name: string }).name === 'complete_task',
    );
    return tool as unknown as { description: string };
  };

  it('shares one tool description with the MCP server', () => {
    expect(piCompleteTask().description).toBe(COMPLETE_TASK_DESCRIPTION);
  });

  // An agent that cannot see the nesting spends a turn on a rejected flat call.
  it.each(['goals', 'did', 'forNextAgent'])(
    'names %s as a field that goes inside the nested handoff',
    (field) => {
      expect(COMPLETE_TASK_DESCRIPTION).toContain(field);
    },
  );

  it('says the handoff is nested', () => {
    expect(COMPLETE_TASK_DESCRIPTION).toMatch(/nested object/);
  });
});
