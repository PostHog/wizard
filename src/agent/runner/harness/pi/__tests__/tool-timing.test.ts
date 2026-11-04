/**
 * Tool timing: per-session totals for `agent completed`, one `tool slow` event
 * per long call, and only a bare program name from a bash command.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analytics } from '@utils/analytics';
import { SLOW_TOOL_MS, commandProgram, createToolTiming } from '../tool-timing';

vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn() },
}));

describe('commandProgram', () => {
  it.each([
    ['pnpm --filter web build', 'pnpm'],
    ['cd apps/web && npx tsc --noEmit', 'npx'],
    ['CI=1 NODE_ENV=production /usr/local/bin/next build', 'next'],
    ['export FOO=1; yarn lint', 'yarn'],
  ])('%s → %s', (command, program) => {
    expect(commandProgram(command)).toBe(program);
  });

  it('drops a program name that is not a plain word', () => {
    expect(commandProgram('$(cat secret) build')).toBeUndefined();
    expect(commandProgram(undefined)).toBeUndefined();
  });
});

describe('createToolTiming', () => {
  afterEach(() => vi.clearAllMocks());

  it('reports a slow call with its program and the given properties', () => {
    const timing = createToolTiming({ task_type: 'review' });
    timing.start('1', 'bash', { command: 'pnpm build', timeout: 600 });
    timing.end('1', 'bash', false, SLOW_TOOL_MS + 0.4);

    expect(analytics.wizardCapture).toHaveBeenCalledWith('tool slow', {
      tool: 'bash',
      duration_ms: SLOW_TOOL_MS,
      is_error: false,
      command_program: 'pnpm',
      task_type: 'review',
    });
  });

  it('sums every call and names the slowest, reporting none of the fast ones', () => {
    const timing = createToolTiming();
    timing.start('1', 'read', { path: 'a.ts' });
    timing.end('1', 'read', false, 40);
    timing.start('2', 'grep', { pattern: 'x' });
    timing.end('2', 'grep', true, 900);
    timing.start('3', 'edit', {});
    timing.end('3', 'edit', false, undefined);

    expect(timing.summary()).toEqual({
      tool_calls: 2,
      tool_time_ms: 940,
      slowest_tool: 'grep',
      slowest_tool_ms: 900,
    });
    expect(analytics.wizardCapture).not.toHaveBeenCalled();
  });
});
