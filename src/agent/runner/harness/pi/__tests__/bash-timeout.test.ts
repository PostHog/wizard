/**
 * Bash timeout cap: one command the model starts must never hold a step longer
 * than the cap, whether it asks for a longer timeout or for none.
 */
import { describe, it, expect, vi } from 'vitest';
import { BASH_TIMEOUT_CAP_SECONDS, withBashTimeoutCap } from '..';

type BashTool = Parameters<typeof withBashTimeoutCap>[0];

function fakeBash() {
  const execute = vi.fn().mockResolvedValue({ content: [] });
  const tool = {
    description: 'Run a command.',
    execute,
  } as unknown as BashTool;
  return { tool: withBashTimeoutCap(tool), execute };
}

function timeoutSent(execute: ReturnType<typeof vi.fn>): unknown {
  return (execute.mock.calls[0][1] as { timeout?: number }).timeout;
}

describe('withBashTimeoutCap', () => {
  it('lowers a timeout above the cap to the cap', async () => {
    const { tool, execute } = fakeBash();
    await tool.execute(
      'id',
      { command: 'pnpm build', timeout: 600 },
      undefined,
      undefined,
      undefined as never,
    );
    expect(timeoutSent(execute)).toBe(BASH_TIMEOUT_CAP_SECONDS);
  });

  it('applies the cap when the model sends no timeout', async () => {
    const { tool, execute } = fakeBash();
    await tool.execute(
      'id',
      { command: 'pnpm build' },
      undefined,
      undefined,
      undefined as never,
    );
    expect(timeoutSent(execute)).toBe(BASH_TIMEOUT_CAP_SECONDS);
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

  it('tells the model about the cap', () => {
    expect(fakeBash().tool.description).toContain(
      `${BASH_TIMEOUT_CAP_SECONDS} seconds`,
    );
  });
});
