/**
 * Bash timeouts: a command with no timeout gets a default, the model's own
 * timeout is honored, and a task's deadline shortens any timeout that outlasts it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  BASH_DEFAULT_TIMEOUT_SECONDS,
  TASK_HANDOFF_RESERVE_SECONDS,
  withBashTimeout,
} from '..';

type BashTool = Parameters<typeof withBashTimeout>[0];

function fakeBash(deadlineAt?: number) {
  const execute = vi.fn().mockResolvedValue({ content: [] });
  const tool = {
    description: 'Run a command.',
    execute,
  } as unknown as BashTool;
  return { tool: withBashTimeout(tool, deadlineAt), execute };
}

async function timeoutSent(deadlineAt: number | undefined, timeout?: number) {
  const { tool, execute } = fakeBash(deadlineAt);
  await tool.execute(
    'id',
    { command: 'pnpm build', timeout },
    undefined,
    undefined,
    undefined as never,
  );
  return (execute.mock.calls[0][1] as { timeout?: number }).timeout;
}

describe('withBashTimeout', () => {
  afterEach(() => vi.useRealTimers());

  it('uses the default when the model sends no timeout', async () => {
    expect(await timeoutSent(undefined)).toBe(BASH_DEFAULT_TIMEOUT_SECONDS);
  });

  it('honors a timeout longer than the default outside a budget', async () => {
    expect(await timeoutSent(undefined, 1800)).toBe(1800);
  });

  it('keeps a shorter timeout and the command as sent', async () => {
    const { tool, execute } = fakeBash();
    await tool.execute(
      'id',
      { command: 'ls', timeout: 30 },
      undefined,
      undefined,
      undefined as never,
    );
    expect(execute.mock.calls[0][1]).toEqual({ command: 'ls', timeout: 30 });
  });

  it('fits a timeout inside the deadline, leaving time for the handoff', async () => {
    vi.useFakeTimers();
    const deadlineAt = Date.now() + 200_000;
    const fitted = 200 - TASK_HANDOFF_RESERVE_SECONDS;
    expect(await timeoutSent(deadlineAt, 600)).toBe(fitted);
    expect(await timeoutSent(deadlineAt)).toBe(fitted);
    expect(await timeoutSent(deadlineAt, 30)).toBe(30);
  });

  it('measures the time left when the command starts', async () => {
    vi.useFakeTimers();
    const deadlineAt = Date.now() + 600_000;
    vi.advanceTimersByTime(500_000);
    expect(await timeoutSent(deadlineAt, 300)).toBe(
      100 - TASK_HANDOFF_RESERVE_SECONDS,
    );
  });

  it('still lets a quick command run once the reserve is reached', async () => {
    vi.useFakeTimers();
    expect(await timeoutSent(Date.now() + 10_000, 300)).toBe(5);
    expect(await timeoutSent(Date.now() - 10_000, 300)).toBe(5);
  });

  it('tells the model about the default, and about the deadline when there is one', () => {
    const plain = fakeBash().tool.description;
    expect(plain).toContain(`${BASH_DEFAULT_TIMEOUT_SECONDS} seconds`);
    expect(plain).not.toContain('time limit');
    expect(fakeBash(Date.now() + 1000).tool.description).toContain(
      'time limit',
    );
  });
});
