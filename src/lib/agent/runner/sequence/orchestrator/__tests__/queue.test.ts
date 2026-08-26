import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  QueueStore,
  QUEUE_DIR_NAME,
  SkipReason,
  type QueueFile,
  type QueuedTask,
  type TaskHandoff,
  type TransitionEvent,
} from '@lib/agent/runner/sequence/orchestrator/queue';

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
    q.skip(a.id, SkipReason.AgentNotNeeded);
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

/** A terminally failed optional dep unblocks dependents; a required one dams the graph. */
describe('optional task failure', () => {
  let dir: string;
  let store: QueueStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-optional-test-'));
    store = new QueueStore(dir, 'run-1');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const failOnce = (id: string) => {
    store.start(id);
    store.fail(id, { type: 'boom', message: 'x' });
  };
  const failTerminally = (id: string) => {
    const t = store.get(id);
    while ((store.get(id)?.attempts ?? 0) < (t?.maxAttempts ?? 0)) {
      failOnce(id);
    }
  };

  it('does not block a dependent once terminally failed', () => {
    const warehouse = store.enqueue({ type: 'warehouse', optional: true });
    const report = store.enqueue({
      type: 'report',
      dependsOn: [warehouse.id],
    });
    failTerminally(warehouse.id);

    expect(store.nextRunnable().map((t) => t.id)).toEqual([report.id]);
    expect(store.isDrained()).toBe(false);
  });

  it('still blocks a dependent while a retry is possible', () => {
    // Agents can self-report failure mid-session, before the executor requeues.
    const warehouse = store.enqueue({ type: 'warehouse', optional: true });
    store.enqueue({ type: 'report', dependsOn: [warehouse.id] });
    failOnce(warehouse.id);

    expect(store.get(warehouse.id)?.attempts).toBeLessThan(
      store.get(warehouse.id)?.maxAttempts ?? 0,
    );
    expect(store.nextRunnable()).toEqual([]);
  });

  it('a required task failing still blocks its dependents', () => {
    const install = store.enqueue({ type: 'install' });
    store.enqueue({ type: 'report', dependsOn: [install.id] });
    failTerminally(install.id);
    expect(store.get(install.id)?.attempts).toBe(
      store.get(install.id)?.maxAttempts,
    );

    expect(store.nextRunnable()).toEqual([]);
    expect(store.isDrained()).toBe(true);
  });
});

/**
 * The one sanctioned mutation of `dependsOn`: closing the gap for a task queued
 * before the planner ran. Additive, pending-only, cycle-checked — the three
 * rules that keep the queue a DAG.
 */
describe('addDependencies', () => {
  let dir: string;
  let store: QueueStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-deps-test-'));
    store = new QueueStore(dir, 'run-1');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('adds edges to a pending task and blocks it behind them', () => {
    const warehouse = store.enqueue({ type: 'warehouse' });
    const install = store.enqueue({ type: 'install' });
    expect(store.nextRunnable().map((t) => t.id)).toContain(warehouse.id);

    const result = store.addDependencies(warehouse.id, [install.id]);

    expect(result).toEqual({ added: [install.id], refused: [] });
    expect(store.get(warehouse.id)?.dependsOn).toEqual([install.id]);
    // The point of the whole change: it is no longer in the first tier.
    expect(store.nextRunnable().map((t) => t.id)).not.toContain(warehouse.id);
  });

  it('is additive — it never drops an edge the task already had', () => {
    const first = store.enqueue({ type: 'install' });
    const warehouse = store.enqueue({
      type: 'warehouse',
      dependsOn: [first.id],
    });
    const second = store.enqueue({ type: 'init' });

    store.addDependencies(warehouse.id, [second.id]);

    expect(store.get(warehouse.id)?.dependsOn).toEqual([first.id, second.id]);
  });

  it('ignores an edge that is already there, without reporting a refusal', () => {
    const install = store.enqueue({ type: 'install' });
    const warehouse = store.enqueue({
      type: 'warehouse',
      dependsOn: [install.id],
    });

    expect(store.addDependencies(warehouse.id, [install.id])).toEqual({
      added: [],
      refused: [],
    });
    expect(store.get(warehouse.id)?.dependsOn).toEqual([install.id]);
  });

  it('refuses a dependency that would close a cycle', () => {
    const warehouse = store.enqueue({ type: 'warehouse' });
    const report = store.enqueue({
      type: 'report',
      dependsOn: [warehouse.id],
    });

    const result = store.addDependencies(warehouse.id, [report.id]);

    expect(result).toEqual({ added: [], refused: [report.id] });
    expect(store.get(warehouse.id)?.dependsOn).toEqual([]);
  });

  it('refuses a cycle through a longer chain', () => {
    const warehouse = store.enqueue({ type: 'warehouse' });
    const mid = store.enqueue({ type: 'capture', dependsOn: [warehouse.id] });
    const far = store.enqueue({ type: 'review', dependsOn: [mid.id] });

    expect(store.addDependencies(warehouse.id, [far.id]).refused).toEqual([
      far.id,
    ]);
  });

  it('refuses an unknown id', () => {
    const warehouse = store.enqueue({ type: 'warehouse' });

    expect(store.addDependencies(warehouse.id, ['nope'])).toEqual({
      added: [],
      refused: ['nope'],
    });
  });

  it('ignores a self-loop', () => {
    const warehouse = store.enqueue({ type: 'warehouse' });

    expect(store.addDependencies(warehouse.id, [warehouse.id])).toEqual({
      added: [],
      refused: [],
    });
    expect(store.get(warehouse.id)?.dependsOn).toEqual([]);
  });

  it('adds the good edges and refuses only the bad ones', () => {
    const warehouse = store.enqueue({ type: 'warehouse' });
    const install = store.enqueue({ type: 'install' });
    const report = store.enqueue({
      type: 'report',
      dependsOn: [warehouse.id],
    });

    const result = store.addDependencies(warehouse.id, [
      install.id,
      report.id,
      'nope',
    ]);

    expect(result.added).toEqual([install.id]);
    expect(result.refused).toEqual([report.id, 'nope']);
  });

  it('leaves a task that already started alone', () => {
    const warehouse = store.enqueue({ type: 'warehouse' });
    const install = store.enqueue({ type: 'install' });
    store.start(warehouse.id);

    const result = store.addDependencies(warehouse.id, [install.id]);

    expect(result).toEqual({ added: [], refused: [install.id] });
    expect(store.get(warehouse.id)?.dependsOn).toEqual([]);
  });

  it('reflects the new edges to queue.json', () => {
    const warehouse = store.enqueue({ type: 'warehouse' });
    const install = store.enqueue({ type: 'install' });
    store.addDependencies(warehouse.id, [install.id]);

    const file = JSON.parse(
      fs.readFileSync(store.queuePath, 'utf8'),
    ) as QueueFile;
    expect(file.tasks.find((t) => t.id === warehouse.id)?.dependsOn).toEqual([
      install.id,
    ]);
  });

  it('throws for a task that is not in the queue at all', () => {
    expect(() => store.addDependencies('nope', [])).toThrow('No task nope');
  });
});

/**
 * Why a skip happened, recorded where the skip happens.
 *
 * A skip has causes that mean opposite things: an agent finding a step does not
 * apply is a no-op, a user declining it is a decision, and an unanswered offer
 * is neither. For a week they were one indistinguishable number on
 * `orchestrator task skipped`, which is how a regression that halved the
 * warehouse completion rate stayed invisible. The reason has to be on the task
 * itself, so the transition listener can read it and the run's queue.json keeps
 * it.
 */
describe('skip reasons', () => {
  let dir: string;
  let q: QueueStore;

  beforeEach(() => {
    dir = tmpDir();
    q = new QueueStore(dir, 'run-1');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it.each([
    ['user-declined', SkipReason.UserDeclined],
    ['notice-timeout', SkipReason.NoticeTimeout],
    ['notice-error', SkipReason.NoticeError],
    ['agent-not-needed', SkipReason.AgentNotNeeded],
  ] as const)('records %s on the task', (expected, reason) => {
    const t = q.enqueue({ type: 'warehouse' });
    q.start(t.id);
    q.skip(t.id, reason);

    expect(q.get(t.id)?.status).toBe('not needed');
    expect(q.get(t.id)?.skipReason).toBe(expected);
  });

  it('hands the reason to the transition listener', () => {
    const seen: { event: TransitionEvent; reason?: string }[] = [];
    const listened = new QueueStore(dir, 'run-1', {
      onTransition: (event: TransitionEvent, task: QueuedTask) =>
        seen.push({ event, reason: task.skipReason }),
    });

    const t = listened.enqueue({ type: 'warehouse' });
    listened.start(t.id);
    listened.skip(t.id, SkipReason.NoticeTimeout);

    expect(seen.at(-1)).toEqual({
      event: 'skip',
      reason: 'notice-timeout',
    });
  });

  it('leaves the reason unset on every other terminal transition', () => {
    const done = q.enqueue({ type: 'install' });
    q.start(done.id);
    q.complete(done.id);
    const failed = q.enqueue({ type: 'capture', maxAttempts: 1 });
    q.start(failed.id);
    q.fail(failed.id, { type: 'API_ERROR', message: 'boom' });

    expect(q.get(done.id)?.skipReason).toBeUndefined();
    expect(q.get(failed.id)?.skipReason).toBeUndefined();
  });

  it('reflects the reason to queue.json, so a finished run still explains itself', () => {
    const t = q.enqueue({ type: 'warehouse' });
    q.start(t.id);
    q.skip(t.id, SkipReason.UserDeclined, {
      goals: 'Connect your data sources',
      did: 'Nothing — the user chose to skip this step when offered it.',
      forNextAgent: 'Report it as skipped at the user’s request.',
    });

    const file = JSON.parse(fs.readFileSync(q.queuePath, 'utf8')) as QueueFile;
    expect(file.tasks.find((t2) => t2.id === t.id)?.skipReason).toBe(
      'user-declined',
    );
  });
});
