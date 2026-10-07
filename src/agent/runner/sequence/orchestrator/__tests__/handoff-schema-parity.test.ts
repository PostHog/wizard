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
  // `HANDOFF_FIELDS` is the anchor: tsc already ties it to `TaskHandoff`, so
  // tying both schemas to it means a field the interface declares can't end up
  // described but unsendable.
  it.each([
    ['zod', HANDOFF_SHAPE_KEYS],
    ['pi', PI_HANDOFF_PARAM_KEYS],
  ])('offers every described field on the %s schema', (_name, keys) => {
    expect([...keys].sort()).toEqual(Object.keys(HANDOFF_FIELDS).sort());
  });
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
});
