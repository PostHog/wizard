import { describe, expect, it } from 'vitest';
import { TOOL_REGISTRY } from '@tools';
import { getTuiTool } from '../index';

describe('tool flows', () => {
  // A tool with no TUI entry falls through to the skill program's flow.
  it('every tool has its own non-empty flow', () => {
    for (const { id } of TOOL_REGISTRY) {
      expect(getTuiTool(id)?.flow.length, id).toBeGreaterThan(0);
    }
  });
});
