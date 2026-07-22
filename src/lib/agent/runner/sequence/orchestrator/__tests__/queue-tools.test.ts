import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QueueStore } from '@lib/agent/runner/sequence/orchestrator/queue';
import {
  applyComplete,
  applyEnqueue,
  applyReadHandoffs,
  checkEnqueueGuards,
  type OrchestratorToolsContext,
} from '@lib/agent/runner/sequence/orchestrator/queue-tools';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'queue-tools-test-'));
}

const VALID = ['install', 'init', 'capture'];

describe('checkEnqueueGuards', () => {
  let dir: string;
  let store: QueueStore;
  let ctx: OrchestratorToolsContext;

  beforeEach(() => {
    dir = tmpDir();
    store = new QueueStore(dir, 'run-1');
    ctx = { store, validTypes: VALID };
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('rejects an unknown type', () => {
    const r = checkEnqueueGuards(ctx, { type: 'nope', reason: 'x' });
    expect(r).toMatchObject({ ok: false, guard: 'unknown-type' });
  });

  it('rejects an unknown dependency', () => {
    const r = checkEnqueueGuards(ctx, {
      type: 'init',
      dependsOn: ['ghost'],
      reason: 'x',
    });
    expect(r).toMatchObject({ ok: false, guard: 'unknown-dep' });
  });

  it('trips dedup on the same type and inputs', () => {
    store.enqueue({ type: 'install', inputs: { pkg: 'posthog-js' } });
    const r = checkEnqueueGuards(ctx, {
      type: 'install',
      inputs: { pkg: 'posthog-js' },
      reason: 'x',
    });
    expect(r).toMatchObject({ ok: false, guard: 'dedup' });
  });

  it('allows a valid enqueue', () => {
    const r = checkEnqueueGuards(ctx, { type: 'init', reason: 'x' });
    expect(r).toEqual({ ok: true });
  });

  it('refuses to grow the queue past the runaway cap', () => {
    for (let i = 0; i < 30; i++) {
      store.enqueue({ type: 'capture', inputs: { i } });
    }
    const r = checkEnqueueGuards(ctx, {
      type: 'init',
      inputs: { i: 30 },
      reason: 'x',
    });
    expect(r).toMatchObject({ ok: false, guard: 'queue-full' });
  });
});

describe('apply functions', () => {
  let dir: string;
  let store: QueueStore;
  let ctx: OrchestratorToolsContext;

  beforeEach(() => {
    dir = tmpDir();
    store = new QueueStore(dir, 'run-1');
    ctx = { store, validTypes: VALID };
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('attributes a seed enqueue to the orchestrator', () => {
    const r = applyEnqueue(ctx, { type: 'install', reason: 'seed' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.task.enqueuedBy).toBe('orchestrator');
  });

  it('attributes a follow-up enqueue to the running task', () => {
    const parent = store.enqueue({ type: 'init' });
    ctx.currentTaskId = parent.id;
    const r = applyEnqueue(ctx, { type: 'capture', reason: 'follow-up' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.task.enqueuedBy).toBe(parent.id);
  });

  it('complete_task fails when no task is running', () => {
    const r = applyComplete(ctx, {
      status: 'done',
      handoff: { goals: 'g', did: 'd', forNextAgent: 'n' },
    });
    expect(r.ok).toBe(false);
  });

  it('complete_task marks the running task done and stores the handoff', () => {
    const t = store.enqueue({ type: 'install' });
    ctx.currentTaskId = t.id;
    store.start(t.id);
    const r = applyComplete(ctx, {
      status: 'done',
      handoff: { goals: 'g', did: 'added sdk', forNextAgent: 'env next' },
    });
    expect(r.ok).toBe(true);
    expect(store.get(t.id)?.status).toBe('done');
    expect(store.readHandoff(t.id)?.did).toBe('added sdk');
  });

  it("complete_task status 'not needed' marks the task not needed, satisfying dependents", () => {
    const t = store.enqueue({ type: 'install' });
    const dependent = store.enqueue({ type: 'init', dependsOn: [t.id] });
    ctx.currentTaskId = t.id;
    store.start(t.id);
    const r = applyComplete(ctx, {
      status: 'not needed',
      handoff: { goals: 'g', did: 'nothing to do', forNextAgent: 'n' },
    });
    expect(r.ok).toBe(true);
    expect(store.get(t.id)?.status).toBe('not needed');
    expect(store.nextRunnable().map((task) => task.id)).toContain(dependent.id);
  });

  it('a remark lands on the task, never in the handoff the next agent reads', () => {
    const dep = store.enqueue({ type: 'install' });
    const dependent = store.enqueue({ type: 'init', dependsOn: [dep.id] });
    ctx.currentTaskId = dep.id;
    store.start(dep.id);
    applyComplete(ctx, {
      status: 'done',
      handoff: { goals: 'g', did: 'd', forNextAgent: 'n' },
      remark: 'the install docs omitted the peer dependency',
    });

    expect(store.get(dep.id)?.remark).toBe(
      'the install docs omitted the peer dependency',
    );
    ctx.currentTaskId = dependent.id;
    for (const args of [{}, { taskId: dep.id }, { type: 'install' }]) {
      const [handoff] = applyReadHandoffs(ctx, args);
      expect(handoff.did).toBe('d');
      expect(Object.keys(handoff)).not.toContain('remark');
    }
  });

  it('read_handoffs returns a dependency handoff for the running task', () => {
    const dep = store.enqueue({ type: 'install' });
    store.start(dep.id);
    store.complete(dep.id, {
      goals: 'g',
      did: 'installed',
      forNextAgent: 'now init',
    });
    const t = store.enqueue({ type: 'init', dependsOn: [dep.id] });
    ctx.currentTaskId = t.id;

    const handoffs = applyReadHandoffs(ctx, {});
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0].did).toBe('installed');
  });
});
