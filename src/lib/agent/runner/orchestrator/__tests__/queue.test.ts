import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  QueueStore,
  QUEUE_DIR_NAME,
  type QueueFile,
  type TaskHandoff,
} from '@lib/agent/runner/orchestrator/queue';

vi.mock('@utils/analytics', () => ({
  analytics: { captureException: vi.fn(), wizardCapture: vi.fn() },
}));

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'queue-test-'));
}

describe('QueueStore', () => {
  let dir: string;
  let q: QueueStore;

  beforeEach(() => {
    dir = tmpDir();
    q = new QueueStore(dir, 'run-1');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('drops a self-explaining .DELETE-ME.md in the cache folder', () => {
    const note = fs.readFileSync(
      path.join(dir, QUEUE_DIR_NAME, '.DELETE-ME.md'),
      'utf8',
    );
    expect(note).toContain('safely delete');
    expect(note).toContain(`${QUEUE_DIR_NAME}/`);
  });

  it('enqueues a pending task with defaults', () => {
    const t = q.enqueue({ type: 'install' });
    expect(t.status).toBe('pending');
    expect(t.attempts).toBe(0);
    expect(t.maxAttempts).toBe(2);
    expect(t.enqueuedBy).toBe('orchestrator');
    expect(t.dependsOn).toEqual([]);
    expect(q.list()).toHaveLength(1);
  });

  it('only marks a task runnable once its dependencies are done', () => {
    const a = q.enqueue({ type: 'install' });
    const b = q.enqueue({ type: 'init', dependsOn: [a.id] });

    expect(q.nextRunnable().map((t) => t.id)).toEqual([a.id]);

    q.start(a.id);
    q.complete(a.id);
    expect(q.nextRunnable().map((t) => t.id)).toEqual([b.id]);
  });

  it('returns every runnable task; the graph alone decides parallelism', () => {
    const a = q.enqueue({ type: 'install' });
    const b = q.enqueue({ type: 'init' });
    q.enqueue({ type: 'capture', dependsOn: [a.id, b.id] });

    // Both independent tasks are runnable at once; the dependent one is not.
    expect(
      q
        .nextRunnable()
        .map((t) => t.id)
        .sort(),
    ).toEqual([a.id, b.id].sort());

    q.start(a.id);
    // An in-progress task is no longer offered.
    expect(q.nextRunnable().map((t) => t.id)).toEqual([b.id]);
  });

  it('treats a skipped dependency as satisfied', () => {
    const a = q.enqueue({ type: 'install' });
    const b = q.enqueue({ type: 'init', dependsOn: [a.id] });

    q.start(a.id);
    q.skip(a.id);
    expect(q.nextRunnable().map((t) => t.id)).toEqual([b.id]);
  });

  it('start increments attempts and supports within-run retry while attempts remain', () => {
    const t = q.enqueue({ type: 'install', maxAttempts: 2 });
    q.start(t.id);
    expect(q.get(t.id)?.attempts).toBe(1);

    q.fail(t.id, { type: 'API_ERROR', message: 'boom' });
    expect(q.get(t.id)?.status).toBe('failed');

    // Retry: attempts (1) < maxAttempts (2), so requeue and run again.
    q.requeue(t.id);
    expect(q.get(t.id)?.status).toBe('pending');
    q.start(t.id);
    expect(q.get(t.id)?.attempts).toBe(2);
  });

  it('completing a task records and reads back a structured handoff', () => {
    const t = q.enqueue({ type: 'install' });
    const handoff: TaskHandoff = {
      goals: 'install the sdk',
      did: 'added posthog-js',
      forNextAgent: 'env vars not set yet',
      filesTouched: ['package.json'],
    };
    q.start(t.id);
    q.complete(t.id, handoff);

    expect(q.get(t.id)?.status).toBe('done');
    expect(q.readHandoff(t.id)).toEqual(handoff);
    expect(q.readHandoffsByType('install')).toEqual([handoff]);
  });

  it('is drained when a pending task is blocked by a failed dependency', () => {
    const a = q.enqueue({ type: 'install' });
    q.enqueue({ type: 'init', dependsOn: [a.id] });

    expect(q.isDrained()).toBe(false);
    q.start(a.id);
    q.fail(a.id, { type: 'API_ERROR', message: 'boom' });

    // init can never run now, and nothing is in progress.
    expect(q.nextRunnable()).toHaveLength(0);
    expect(q.isDrained()).toBe(true);
  });

  it('reflects every transition to queue.json, handoffs included', () => {
    const a = q.enqueue({ type: 'install' });
    q.start(a.id);
    q.complete(a.id, {
      goals: 'g',
      did: 'd',
      forNextAgent: 'n',
    });

    const file = JSON.parse(fs.readFileSync(q.queuePath, 'utf8')) as QueueFile;
    expect(file.version).toBe(1);
    expect(file.runId).toBe('run-1');
    expect(file.tasks).toHaveLength(1);
    expect(file.tasks[0].status).toBe('done');
    expect(file.tasks[0].handoff?.did).toBe('d');
  });

  it('notifies the transition listener with post-transition task state', () => {
    const seen: Array<{ event: string; status: string; attempts: number }> = [];
    const listened = new QueueStore(dir, 'run-2', {
      onTransition: (event, task) =>
        seen.push({ event, status: task.status, attempts: task.attempts }),
    });

    const t = listened.enqueue({ type: 'install' });
    listened.start(t.id);
    listened.fail(t.id, { type: 'API_ERROR', message: 'boom' });
    listened.requeue(t.id);
    listened.start(t.id);
    listened.complete(t.id);

    expect(seen).toEqual([
      { event: 'enqueue', status: 'pending', attempts: 0 },
      { event: 'start', status: 'running', attempts: 1 },
      { event: 'fail', status: 'failed', attempts: 1 },
      { event: 'requeue', status: 'pending', attempts: 1 },
      { event: 'start', status: 'running', attempts: 2 },
      { event: 'complete', status: 'done', attempts: 2 },
    ]);
  });

  it('a throwing listener does not break transitions', () => {
    const listened = new QueueStore(dir, 'run-3', {
      onTransition: () => {
        throw new Error('listener boom');
      },
    });
    const t = listened.enqueue({ type: 'install' });
    listened.start(t.id);
    listened.complete(t.id);
    expect(listened.get(t.id)?.status).toBe('done');
  });
});
