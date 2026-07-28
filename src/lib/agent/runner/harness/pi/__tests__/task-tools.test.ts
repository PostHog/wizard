/**
 * The wizard tool vocabulary → pi tool mapping for orchestrator tasks: which
 * pi tools a task's allow list unlocks, which queue tools its disallow list
 * removes, and the names the security fence blocks.
 */
import { describe, it, expect } from 'vitest';
import {
  allowedPiCodingTools,
  allowedOrchestratorTools,
  fenceDisallowList,
} from '../task';

describe('allowedPiCodingTools', () => {
  it('maps the wizard vocabulary to pi tool names', () => {
    expect(allowedPiCodingTools(['Read', 'Edit', 'Glob', 'Grep'])).toEqual(
      new Set(['read', 'edit', 'find', 'ls', 'grep']),
    );
  });

  it('unlocks bash and write only when allowed', () => {
    const tools = allowedPiCodingTools(['Read', 'Write', 'Bash']);
    expect(tools).toEqual(new Set(['read', 'write', 'bash']));
  });

  it('an empty allow list means every coding tool', () => {
    expect(allowedPiCodingTools([])).toEqual(
      new Set(['read', 'edit', 'write', 'bash', 'find', 'ls', 'grep']),
    );
    expect(allowedPiCodingTools(undefined)).toEqual(
      new Set(['read', 'edit', 'write', 'bash', 'find', 'ls', 'grep']),
    );
  });

  it('ignores names outside the vocabulary (orchestrator tools are not coding tools)', () => {
    expect(
      allowedPiCodingTools(['Read', 'mcp__posthog-wizard__complete_task']),
    ).toEqual(new Set(['read']));
  });
});

describe('allowedOrchestratorTools', () => {
  it('a task agent (enqueue disallowed) keeps complete_task and read_handoffs', () => {
    expect(
      allowedOrchestratorTools(['mcp__posthog-wizard__enqueue_task']),
    ).toEqual(new Set(['complete_task', 'read_handoffs']));
  });

  it('the seed (complete_task disallowed) keeps enqueue_task and read_handoffs', () => {
    expect(
      allowedOrchestratorTools([
        'Write',
        'Edit',
        'Bash',
        'mcp__posthog-wizard__complete_task',
      ]),
    ).toEqual(new Set(['enqueue_task', 'read_handoffs']));
  });

  it('short names disallow too', () => {
    expect(allowedOrchestratorTools(['enqueue_task'])).toEqual(
      new Set(['complete_task', 'read_handoffs']),
    );
  });
});

describe('fenceDisallowList', () => {
  it('carries both the given names and the pi-short orchestrator names', () => {
    expect(
      fenceDisallowList(['Write', 'mcp__posthog-wizard__enqueue_task']),
    ).toEqual(['Write', 'mcp__posthog-wizard__enqueue_task', 'enqueue_task']);
  });

  it('is empty for an empty disallow list', () => {
    expect(fenceDisallowList(undefined)).toEqual([]);
  });
});
