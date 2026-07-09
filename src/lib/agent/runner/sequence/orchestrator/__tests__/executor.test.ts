import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  QueueStore,
  type QueuedTask,
  type TaskHandoff,
} from '@lib/agent/runner/sequence/orchestrator/queue';
import {
  drainQueue,
  type RunTask,
} from '@lib/agent/runner/sequence/orchestrator/executor';

vi.mock('@utils/analytics', () => ({
  analytics: { captureException: vi.fn(), wizardCapture: vi.fn() },
}));
import { analytics } from '@utils/analytics';

const HANDOFF: TaskHandoff = { goals: 'g', did: 'd', forNextAgent: 'n' };

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'executor-test-'));
}

describe('drainQueue', () => {
  let dir: string;
  let q: QueueStore;

  beforeEach(() => {
    dir = tmpDir();
    q = new QueueStore(dir, 'run-1');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const completing: RunTask = (task) => {
    q.complete(task.id, HANDOFF);
    return Promise.resolve();
  };

  it('runs a single task to done and drains', async () => {
    const a = q.enqueue({ type: 'install' });
    await drainQueue(q, completing, { maxStarts: 50 });
    expect(q.get(a.id)?.status).toBe('done');
    expect(q.isDrained()).toBe(true);
  });

  it('runs a dependent task only after its dependency completes', async () => {
    const order: string[] = [];
    const a = q.enqueue({ type: 'install' });
    const b = q.enqueue({ type: 'init', dependsOn: [a.id] });
    const runner: RunTask = (task) => {
      order.push(task.type);
      q.complete(task.id, HANDOFF);
      return Promise.resolve();
    };
    await drainQueue(q, runner, { maxStarts: 50 });
    expect(order).toEqual(['install', 'init']);
    expect(q.get(b.id)?.status).toBe('done');
  });

  it('runs independent branches concurrently; the graph is the only schedule', async () => {
    let active = 0;
    let maxActive = 0;
    const runner: RunTask = async (task) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      q.complete(task.id, HANDOFF);
      active -= 1;
    };
    const a = q.enqueue({ type: 'install' });
    const b = q.enqueue({ type: 'init' });
    q.enqueue({ type: 'capture', dependsOn: [a.id, b.id] });
    await drainQueue(q, runner, { maxStarts: 50 });
    // install and init overlap; capture waits for both.
    expect(maxActive).toBe(2);
    expect(q.summary().done).toBe(3);
  });

  it('starts a dependent the moment its dependency finishes, not in waves', async () => {
    const startedAt: Record<string, number> = {};
    let clock = 0;
    const runner: RunTask = async (task) => {
      startedAt[task.type] = clock++;
      // slow holds the wave open; fast finishes early and unblocks after-fast.
      const delay = task.type === 'slow' ? 30 : 5;
      await new Promise((r) => setTimeout(r, delay));
      q.complete(task.id, HANDOFF);
    };
    q.enqueue({ type: 'slow' });
    const fast = q.enqueue({ type: 'fast' });
    q.enqueue({ type: 'after-fast', dependsOn: [fast.id] });
    await drainQueue(q, runner, { maxStarts: 50 });
    // after-fast started while slow was still running.
    expect(startedAt['after-fast']).toBeDefined();
    expect(q.summary().done).toBe(3);
  });

  it('retries a task that ends without reporting, then fails it', async () => {
    const a = q.enqueue({ type: 'install', maxAttempts: 2 });
    const noReport: RunTask = async () => {
      /* agent never calls complete_task */
    };
    await drainQueue(q, noReport, { maxStarts: 50 });
    expect(q.get(a.id)?.status).toBe('failed');
    expect(q.get(a.id)?.attempts).toBe(2);
  });

  it('succeeds on a retry within the attempt budget', async () => {
    let calls = 0;
    const a = q.enqueue({ type: 'install', maxAttempts: 3 });
    const flaky: RunTask = (task: QueuedTask) => {
      calls += 1;
      if (calls >= 2) q.complete(task.id, HANDOFF);
      return Promise.resolve();
    };
    await drainQueue(q, flaky, { maxStarts: 50 });
    expect(q.get(a.id)?.status).toBe('done');
    expect(calls).toBe(2);
  });

  it('captures and fails a task whose runner throws', async () => {
    const a = q.enqueue({ type: 'install', maxAttempts: 1 });
    const throwing: RunTask = () => Promise.reject(new Error('agent exploded'));
    await drainQueue(q, throwing, { maxStarts: 50 });
    expect(q.get(a.id)?.status).toBe('failed');
    expect(analytics.captureException).toHaveBeenCalled();
  });

  it('does not run a task whose dependency failed', async () => {
    const a = q.enqueue({ type: 'install', maxAttempts: 1 });
    const b = q.enqueue({ type: 'init', dependsOn: [a.id] });
    const runner: RunTask = (task) => {
      if (task.type === 'init') q.complete(task.id, HANDOFF);
      // install never reports, so it fails after its single attempt.
      return Promise.resolve();
    };
    await drainQueue(q, runner, { maxStarts: 50 });
    expect(q.get(a.id)?.status).toBe('failed');
    expect(q.get(b.id)?.status).toBe('pending');
    expect(q.isDrained()).toBe(true);
  });

  it('terminates via the start backstop instead of looping forever', async () => {
    const a = q.enqueue({ type: 'install', maxAttempts: 999 });
    const neverReports: RunTask = async () => {
      /* would retry forever without the backstop */
    };
    await drainQueue(q, neverReports, { maxStarts: 3 });
    expect(q.get(a.id)?.attempts).toBeLessThanOrEqual(3);
  });
});
