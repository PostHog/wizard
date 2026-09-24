import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ErrorCodes } from '@shared/errors';
import {
  QueueStore,
  TaskStatus,
  type QueuedTask,
  type TaskHandoff,
} from '@agent/runner/sequence/orchestrator/queue';
import {
  drainQueue,
  RunTaskFatal,
  type RunTask,
} from '@agent/runner/sequence/orchestrator/executor';

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

  it.each(['a fatal error', 'host cancellation'])(
    'waits for live siblings after %s and starts no dependents',
    async (ending) => {
      const controller = new AbortController();
      const fatal = new RunTaskFatal({
        code: ErrorCodes.AgentOrchestratorTasksFailed,
        message: 'Authentication failed',
      });
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      q.enqueue({ type: 'first' });
      const sibling = q.enqueue({ type: 'sibling' });
      q.enqueue({ type: 'dependent', dependsOn: [sibling.id] });
      const started: string[] = [];
      const drain = drainQueue(
        q,
        async (task) => {
          started.push(task.type);
          if (task.type === 'first') {
            await Promise.resolve(); // Let the sibling start first.
            if (ending === 'a fatal error') throw fatal;
            controller.abort();
            return;
          }
          await blocked;
          q.complete(task.id, HANDOFF);
        },
        { maxStarts: 50, signal: controller.signal },
      );
      let settled = false;
      const result = drain
        .catch((error: unknown) => error)
        .finally(() => {
          settled = true;
        });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
      expect(started).toEqual(['first', 'sibling']);
      release();
      expect(await result).toBe(ending === 'a fatal error' ? fatal : undefined);
      expect(q.get(sibling.id)?.status).toBe(TaskStatus.Done);
      expect(started).toEqual(['first', 'sibling']);
    },
  );

  it('preserves a fatal failure when a sibling completes in the same turn', async () => {
    q.enqueue({ type: 'success' });
    q.enqueue({ type: 'fatal' });
    const fatal = new RunTaskFatal({
      code: ErrorCodes.AgentOrchestratorTasksFailed,
      message: 'Authentication failed',
    });
    await expect(
      drainQueue(q, (task) => {
        if (task.type === 'fatal') return Promise.reject(fatal);
        q.complete(task.id, HANDOFF);
        return Promise.resolve();
      }),
    ).rejects.toBe(fatal);
  });

  it('cancels and joins an active sibling while retaining the first fatal', async () => {
    const controller = new AbortController();
    const fatal = new RunTaskFatal({
      code: ErrorCodes.AgentOrchestratorTasksFailed,
      message: 'First failure',
    });
    const later = new RunTaskFatal({
      code: ErrorCodes.AgentOrchestratorTasksFailed,
      message: 'Abort noise',
    });
    const a = q.enqueue({ type: 'fatal' });
    q.enqueue({ type: 'asking' });
    const queued = q.enqueue({ type: 'queued', dependsOn: [a.id] });
    const started: string[] = [];
    let siblingSettled = false;
    const result = drainQueue(
      q,
      async (task) => {
        started.push(task.type);
        if (task.type === 'fatal') throw fatal;
        await new Promise<void>((resolve) =>
          controller.signal.addEventListener('abort', () => resolve(), {
            once: true,
          }),
        );
        siblingSettled = true;
        throw later;
      },
      {
        maxStarts: 50,
        signal: controller.signal,
        onFatal: () => {
          controller.abort();
          throw new Error('Cancellation cleanup failed');
        },
      },
    ).catch((error: unknown) => error);

    expect(await result).toBe(fatal);
    expect(controller.signal.aborted).toBe(true);
    expect(siblingSettled).toBe(true);
    expect(started).toEqual(['fatal', 'asking']);
    expect(q.get(queued.id)?.status).toBe(TaskStatus.Pending);
  });

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

/** The drain waits a failing optional task to terminal state; nothing is silently skipped. */
describe('drainQueue — optional task failure', () => {
  let dir: string;
  let q: QueueStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'executor-optional-test-'));
    q = new QueueStore(dir, 'run-1');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const HANDOFF: TaskHandoff = { goals: 'g', did: 'd', forNextAgent: 'n' };

  it('retries a failing optional task to terminal failure, then runs the dependent', async () => {
    const warehouse = q.enqueue({ type: 'warehouse', optional: true });
    const report = q.enqueue({ type: 'report', dependsOn: [warehouse.id] });

    const order: string[] = [];
    const runTask: RunTask = (task) => {
      order.push(`${task.type}#${task.attempts}`);
      if (task.type === 'warehouse') {
        q.fail(task.id, { type: 'boom', message: 'x' });
      } else {
        // The dependent starts only against a settled outcome.
        expect(q.get(warehouse.id)?.status).toBe(TaskStatus.Failed);
        expect(q.get(warehouse.id)?.attempts).toBe(
          q.get(warehouse.id)?.maxAttempts,
        );
        q.complete(task.id, HANDOFF);
      }
      return Promise.resolve();
    };

    await drainQueue(q, runTask);

    // Both warehouse attempts ran before report started — waited, not skipped.
    expect(order).toEqual(['warehouse#1', 'warehouse#2', 'report#1']);
    expect(q.get(warehouse.id)?.status).toBe(TaskStatus.Failed);
    expect(q.get(report.id)?.status).toBe(TaskStatus.Done);
    // Every task reached a terminal state; none left pending or running.
    expect(
      q
        .list()
        .every(
          (t) =>
            t.status === TaskStatus.Done ||
            t.status === TaskStatus.Failed ||
            t.status === TaskStatus.Skipped,
        ),
    ).toBe(true);
  });

  it('a slow failing optional task holds the whole drain open', async () => {
    const warehouse = q.enqueue({ type: 'warehouse', optional: true });
    const install = q.enqueue({ type: 'install' });
    const report = q.enqueue({
      type: 'report',
      dependsOn: [warehouse.id, install.id],
    });

    let releaseWarehouse!: () => void;
    const gate = new Promise<void>((r) => (releaseWarehouse = r));
    const runTask: RunTask = async (task) => {
      if (task.type === 'warehouse') {
        if (task.attempts === 1) await gate;
        q.fail(task.id, { type: 'boom', message: 'x' });
        return;
      }
      q.complete(task.id, HANDOFF);
    };

    const drain = drainQueue(q, runTask);
    // Give install time to finish while warehouse hangs on its first attempt.
    await new Promise((r) => setTimeout(r, 10));
    expect(q.get(install.id)?.status).toBe(TaskStatus.Done);
    // The drain is still open and report has not started: waiting, not skipping.
    expect(q.get(report.id)?.status).toBe(TaskStatus.Pending);

    releaseWarehouse();
    await drain;

    expect(q.get(warehouse.id)?.status).toBe(TaskStatus.Failed);
    expect(q.get(report.id)?.status).toBe(TaskStatus.Done);
  });

  it('an optional task that succeeds on retry feeds its dependent normally', async () => {
    const warehouse = q.enqueue({ type: 'warehouse', optional: true });
    const report = q.enqueue({ type: 'report', dependsOn: [warehouse.id] });

    const runTask: RunTask = (task) => {
      if (task.type === 'warehouse' && task.attempts === 1) {
        q.fail(task.id, { type: 'boom', message: 'x' });
      } else if (task.type === 'warehouse') {
        q.complete(task.id, { ...HANDOFF, reportSection: '## Sources' });
      } else {
        expect(q.readHandoff(warehouse.id)?.reportSection).toBe('## Sources');
        q.complete(task.id, HANDOFF);
      }
      return Promise.resolve();
    };

    await drainQueue(q, runTask);
    expect(q.get(warehouse.id)?.status).toBe(TaskStatus.Done);
    expect(q.get(report.id)?.status).toBe(TaskStatus.Done);
  });
});
