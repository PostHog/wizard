import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBashToolDefinition } from '@earendil-works/pi-coding-agent';
import { withBashTimeout } from '..';
import {
  withTaskDeadline,
  TaskDeadlineExceeded,
} from '../../../sequence/orchestrator/task-deadline';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bash-cancel-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function command(): string {
  const script = `require("node:fs").writeFileSync("child.pid", String(process.pid)); console.log("ready"); setTimeout(() => require("node:fs").writeFileSync("survived", "yes"), 1000); setInterval(() => {}, 1000);`;
  return `"${process.execPath}" -e '${script}' & wait`;
}

async function assertStopped() {
  const pid = Number(readFileSync(join(dir, 'child.pid'), 'utf8'));
  expect(pid).toBeGreaterThan(0);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  expect(existsSync(join(dir, 'survived'))).toBe(false);
}

it('a real bash timeout kills a hanging shell and its child', async () => {
  const tool = withBashTimeout(createBashToolDefinition(dir));
  await expect(
    tool.execute(
      'timeout',
      { command: command(), timeout: 0.5 },
      undefined,
      undefined,
      undefined as never,
    ),
  ).rejects.toThrow('timed out');
  await assertStopped();
});

it('a task deadline cancels an active bash process before its own timeout', async () => {
  const tool = withBashTimeout(createBashToolDefinition(dir));
  await expect(
    withTaskDeadline(500, undefined, (signal) =>
      tool.execute(
        'deadline',
        { command: command(), timeout: 30 },
        signal,
        undefined,
        undefined as never,
      ),
    ),
  ).rejects.toBeInstanceOf(TaskDeadlineExceeded);
  await assertStopped();
});

it('host cancellation stops active bash work and preserves its abort result', async () => {
  const tool = withBashTimeout(createBashToolDefinition(dir));
  const host = new AbortController();
  await expect(
    tool.execute(
      'cancel',
      { command: command(), timeout: 30 },
      host.signal,
      (update) => {
        if (
          update.content.some(
            (block) => block.type === 'text' && block.text.includes('ready'),
          )
        )
          host.abort();
      },
      undefined as never,
    ),
  ).rejects.toThrow('aborted');
  await assertStopped();
});
