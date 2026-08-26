/**
 * The sink guard: a task marked `sink: true` runs last, so it must wait for
 * every other task in the queue. It is what stops a task the wizard seeded
 * before the planner ran from being left un-awaited by the reporting step.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn() },
}));

import {
  QueueStore,
  SkipReason,
} from '@lib/agent/runner/sequence/orchestrator/queue';
import { displayOrder } from '@lib/agent/runner/sequence/orchestrator/orchestrator-runner';
import {
  applyEnqueue,
  checkEnqueueGuards,
  dependencyClosure,
  uncoveredBySink,
  type OrchestratorToolsContext,
} from '@lib/agent/runner/sequence/orchestrator/queue-tools';
import { seededDependencies } from '@lib/agent/runner/sequence/orchestrator/seeded-deps';

const VALID = ['warehouse', 'install', 'capture', 'report'];
const SINKS = ['report'];

describe('sink closure', () => {
  let dir: string;
  let store: QueueStore;
  let ctx: OrchestratorToolsContext;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sink-closure-test-'));
    store = new QueueStore(dir, 'run-1');
    ctx = { store, validTypes: VALID, sinkTypes: SINKS };
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('walks the whole transitive chain, not just direct dependencies', () => {
    const a = store.enqueue({ type: 'install' });
    const b = store.enqueue({ type: 'capture', dependsOn: [a.id] });
    expect([...dependencyClosure(store, [b.id])].sort()).toEqual(
      [a.id, b.id].sort(),
    );
  });

  it('rejects a sink that misses a task the wizard seeded before the planner', () => {
    const warehouse = store.enqueue({ type: 'warehouse' });
    const install = store.enqueue({ type: 'install' });

    const r = checkEnqueueGuards(ctx, {
      type: 'report',
      dependsOn: [install.id],
      reason: 'write the report',
    });

    expect(r).toMatchObject({ ok: false, guard: 'sink-closure' });
    expect(r.ok === false && r.message).toContain(warehouse.id);
  });

  it('accepts a sink that reaches every task through its dependencies', () => {
    const warehouse = store.enqueue({ type: 'warehouse' });
    const install = store.enqueue({ type: 'install' });
    const capture = store.enqueue({
      type: 'capture',
      dependsOn: [install.id, warehouse.id],
    });

    const r = checkEnqueueGuards(ctx, {
      type: 'report',
      dependsOn: [capture.id],
      reason: 'write the report',
    });

    expect(r).toEqual({ ok: true });
  });

  it('leaves a non-sink type alone', () => {
    store.enqueue({ type: 'warehouse' });
    const r = checkEnqueueGuards(ctx, { type: 'capture', reason: 'x' });
    expect(r).toEqual({ ok: true });
  });

  it('does not apply when the flow declares no sink', () => {
    store.enqueue({ type: 'warehouse' });
    const r = checkEnqueueGuards(
      { store, validTypes: VALID },
      { type: 'report', reason: 'x' },
    );
    expect(r).toEqual({ ok: true });
  });

  it('reports what a queued sink fails to wait for', () => {
    const warehouse = store.enqueue({ type: 'warehouse' });
    const install = store.enqueue({ type: 'install' });
    const report = applyEnqueue(
      { store, validTypes: VALID },
      { type: 'report', dependsOn: [install.id], reason: 'x' },
    );

    expect(report.ok).toBe(true);
    const uncovered = uncoveredBySink(ctx, {
      type: 'report',
      dependsOn: report.ok ? report.task.dependsOn : [],
    }).filter((t) => t.type !== 'report');

    expect(uncovered.map((t) => t.id)).toEqual([warehouse.id]);
  });
});

/**
 * Display order is not queue order. A task the wizard seeded runs first but is
 * an optional side quest, so it must not head the list the user reads.
 */
describe('displayOrder', () => {
  let dir: string;
  let store: QueueStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'display-order-test-'));
    store = new QueueStore(dir, 'run-1');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const optional = (t: { type: string }) => t.type === 'warehouse';

  it('puts an optional task after the work it runs alongside', () => {
    const warehouse = store.enqueue({ type: 'warehouse' });
    const install = store.enqueue({ type: 'install' });
    const init = store.enqueue({ type: 'init' });
    const capture = store.enqueue({
      type: 'capture',
      dependsOn: [install.id, init.id],
    });
    store.enqueue({ type: 'report', dependsOn: [capture.id, warehouse.id] });

    expect(displayOrder(store.list(), optional).map((t) => t.type)).toEqual([
      'install',
      'init',
      'warehouse',
      'capture',
      'report',
    ]);
    // This fixture is the queue as the planner leaves it, before the runner
    // defers the seeded task — which is why displayOrder needed an
    // optional-last rule at all. In a real run the deferral has happened by
    // now and the task genuinely is last; see the deferred suites below.
    expect(store.nextRunnable().map((t) => t.type)).toContain('warehouse');
  });

  it('leaves a queue without optional tasks in dependency order', () => {
    const install = store.enqueue({ type: 'install' });
    const capture = store.enqueue({ type: 'capture', dependsOn: [install.id] });
    store.enqueue({ type: 'report', dependsOn: [capture.id] });

    expect(displayOrder(store.list(), optional).map((t) => t.type)).toEqual([
      'install',
      'capture',
      'report',
    ]);
  });

  it('keeps enqueue order among tasks at the same depth', () => {
    const install = store.enqueue({ type: 'install' });
    store.enqueue({ type: 'identify', dependsOn: [install.id] });
    store.enqueue({ type: 'error-tracking', dependsOn: [install.id] });

    expect(displayOrder(store.list(), optional).map((t) => t.type)).toEqual([
      'install',
      'identify',
      'error-tracking',
    ]);
  });
});

/**
 * Deferring a runner-seeded task rewires the graph between planning and the
 * drain, so the sink invariant has to survive it — and the guard that catches a
 * planner which forgot the sink→seeded edge must keep catching it.
 */
describe('sink closure with a deferred seeded task', () => {
  let dir: string;
  let store: QueueStore;
  let ctx: OrchestratorToolsContext;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sink-deferred-test-'));
    store = new QueueStore(dir, 'run-1');
    ctx = { store, validTypes: VALID, sinkTypes: SINKS };
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('still covers the whole queue once the seeded task runs last', () => {
    const warehouse = store.enqueue({ type: 'warehouse', optional: true });
    const install = store.enqueue({ type: 'install' });
    const capture = store.enqueue({ type: 'capture', dependsOn: [install.id] });
    // The planner wires the sink to everything, seeded task included.
    const report = store.enqueue({
      type: 'report',
      dependsOn: [capture.id, warehouse.id],
    });

    // Defer: warehouse now waits for the work it used to run alongside.
    const deferred = seededDependencies(store, warehouse.id, [], SINKS);
    store.addDependencies(warehouse.id, deferred.depIds);

    const uncovered = uncoveredBySink(ctx, {
      type: 'report',
      dependsOn: report.dependsOn,
    }).filter((t) => t.id !== report.id);
    expect(uncovered).toEqual([]);
  });

  it('runs the seeded task after the code work but before the sink', () => {
    const warehouse = store.enqueue({ type: 'warehouse', optional: true });
    const install = store.enqueue({ type: 'install' });
    const capture = store.enqueue({ type: 'capture', dependsOn: [install.id] });
    store.enqueue({ type: 'report', dependsOn: [capture.id, warehouse.id] });

    const deferred = seededDependencies(store, warehouse.id, [], SINKS);
    store.addDependencies(warehouse.id, deferred.depIds);

    // Nothing runnable but install, so the ask cannot land yet.
    expect(store.nextRunnable().map((t) => t.type)).toEqual(['install']);

    const drain = (type: string) => {
      const task = store.nextRunnable().find((t) => t.type === type);
      if (!task) throw new Error(`${type} was not runnable`);
      store.start(task.id);
      store.complete(task.id);
    };
    drain('install');
    drain('capture');

    // Only now, with the code work done, does the human-blocking step open.
    expect(store.nextRunnable().map((t) => t.type)).toEqual(['warehouse']);
    drain('warehouse');
    expect(store.nextRunnable().map((t) => t.type)).toEqual(['report']);
  });

  it('leaves a planner that forgot the sink edge still failing the invariant', () => {
    const warehouse = store.enqueue({ type: 'warehouse', optional: true });
    const install = store.enqueue({ type: 'install' });
    // The planner omits warehouse from the sink's dependencies.
    const report = store.enqueue({ type: 'report', dependsOn: [install.id] });

    const deferred = seededDependencies(store, warehouse.id, [], SINKS);
    store.addDependencies(warehouse.id, deferred.depIds);

    // Deferring must not paper this over by inverting the edge.
    expect(store.get(warehouse.id)?.dependsOn).not.toContain(report.id);
    const uncovered = uncoveredBySink(ctx, {
      type: 'report',
      dependsOn: report.dependsOn,
    }).filter((t) => t.id !== report.id);
    expect(uncovered.map((t) => t.type)).toEqual(['warehouse']);
  });

  it('sorts the deferred task last in the display order it now really runs in', () => {
    const warehouse = store.enqueue({ type: 'warehouse', optional: true });
    const install = store.enqueue({ type: 'install' });
    store.enqueue({ type: 'report', dependsOn: [install.id, warehouse.id] });

    const deferred = seededDependencies(store, warehouse.id, [], SINKS);
    store.addDependencies(warehouse.id, deferred.depIds);

    const order = displayOrder(store.list(), (t) => t.type === 'warehouse').map(
      (t) => t.type,
    );
    expect(order).toEqual(['install', 'warehouse', 'report']);
  });
});

/**
 * Applying a decline that was given at the top of the run.
 *
 * The offer is made at seed time, but the answer cannot be acted on there: the
 * task must still enter the queue as an ordinary pending task so the planner
 * plans around it and the sink is made to depend on it. By the time the drain
 * reaches the task the sink already waits for it, so declining has to skip it,
 * not remove it — and the skip has to carry why.
 */
describe('a declined seeded task', () => {
  let dir: string;
  let store: QueueStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'declined-seeded-test-'));
    store = new QueueStore(dir, 'run-1');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('still lets the sink run, carrying a handoff that says it was declined', () => {
    const warehouse = store.enqueue({ type: 'warehouse', optional: true });
    const install = store.enqueue({ type: 'install' });
    const report = store.enqueue({
      type: 'report',
      dependsOn: [install.id, warehouse.id],
    });
    const deferred = seededDependencies(store, warehouse.id, [], SINKS);
    store.addDependencies(warehouse.id, deferred.depIds);

    store.start(install.id);
    store.complete(install.id);

    // The step comes up, and the answer taken at seed time is applied.
    expect(store.nextRunnable().map((t) => t.type)).toEqual(['warehouse']);
    store.start(warehouse.id);
    store.skip(warehouse.id, SkipReason.UserDeclined, {
      goals: 'Connect your data sources',
      did: 'Nothing — the user chose to skip this step when offered it.',
      forNextAgent: 'This step was offered and declined, so it did no work.',
    });

    // The sink is not dammed by the decline, and can say what happened.
    expect(store.nextRunnable().map((t) => t.id)).toEqual([report.id]);
    expect(store.readHandoff(warehouse.id)?.did).toContain('chose to skip');
    expect(store.get(warehouse.id)?.skipReason).toBe('user-declined');
  });

  it('is not retried — a decline is an answer, not a failure', () => {
    const warehouse = store.enqueue({ type: 'warehouse', optional: true });
    store.start(warehouse.id);
    store.skip(warehouse.id, SkipReason.UserDeclined);

    expect(store.get(warehouse.id)?.status).toBe('not needed');
    expect(store.nextRunnable()).toEqual([]);
    expect(store.isDrained()).toBe(true);
  });
});

/**
 * The one-way rule, enforced.
 *
 * A runner-seeded task is deferred to the end and stops to ask the user for
 * input, so anything waiting on it inherits that wait. Prose in the seed prompt
 * cannot hold this: one planner edge empties the seeded task's resolved
 * dependencies (the resolver drops anything downstream of it to stay acyclic)
 * and drops it back to depth 0 — the exact placement deferring it removes.
 */
describe('one-way rule for runner-seeded tasks', () => {
  let dir: string;
  let store: QueueStore;
  let ctx: OrchestratorToolsContext;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'one-way-test-'));
    store = new QueueStore(dir, 'run-1');
    ctx = {
      store,
      validTypes: VALID,
      sinkTypes: SINKS,
      runnerSeededTypes: ['warehouse'],
    };
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('rejects a non-sink task that depends on the seeded task directly', () => {
    const warehouse = store.enqueue({ type: 'warehouse', optional: true });

    const r = checkEnqueueGuards(ctx, {
      type: 'install',
      dependsOn: [warehouse.id],
      reason: 'x',
    });

    expect(r).toMatchObject({ ok: false, guard: 'seeded-dep' });
    expect(r.ok === false && r.message).toContain('only the final reporting');
  });

  it('rejects one that reaches it through an intermediate hop', () => {
    const warehouse = store.enqueue({ type: 'warehouse', optional: true });
    // The intermediate would itself be rejected; construct it directly to prove
    // the guard walks the closure rather than only direct dependencies.
    const install = store.enqueue({
      type: 'install',
      dependsOn: [warehouse.id],
    });

    const r = checkEnqueueGuards(ctx, {
      type: 'capture',
      dependsOn: [install.id],
      reason: 'x',
    });

    expect(r).toMatchObject({ ok: false, guard: 'seeded-dep' });
  });

  it('still lets the sink depend on it — that edge is required', () => {
    const warehouse = store.enqueue({ type: 'warehouse', optional: true });
    const install = store.enqueue({ type: 'install' });

    expect(
      checkEnqueueGuards(ctx, {
        type: 'report',
        dependsOn: [install.id, warehouse.id],
        reason: 'x',
      }),
    ).toEqual({ ok: true });
  });

  it('leaves ordinary dependencies between planner tasks alone', () => {
    store.enqueue({ type: 'warehouse', optional: true });
    const install = store.enqueue({ type: 'install' });

    expect(
      checkEnqueueGuards(ctx, {
        type: 'capture',
        dependsOn: [install.id],
        reason: 'x',
      }),
    ).toEqual({ ok: true });
  });

  it('is inert for a flow with no runner-seeded types', () => {
    const warehouse = store.enqueue({ type: 'warehouse' });

    expect(
      checkEnqueueGuards(
        { store, validTypes: VALID, sinkTypes: SINKS },
        { type: 'install', dependsOn: [warehouse.id], reason: 'x' },
      ),
    ).toEqual({ ok: true });
  });

  it('points a sink at the only legal placement for a seeded task', () => {
    store.enqueue({ type: 'warehouse', optional: true });

    const r = checkEnqueueGuards(ctx, { type: 'report', reason: 'x' });

    expect(r).toMatchObject({ ok: false, guard: 'sink-closure' });
    // The generic advice ("or to a task already in dependsOn") is what invited
    // the broken shape in the first place.
    expect(r.ok === false && r.message).not.toContain(
      'a task already in dependsOn',
    );
    expect(r.ok === false && r.message).toContain('only legal spot');
  });

  it('keeps the generic sink advice when no seeded task is uncovered', () => {
    const install = store.enqueue({ type: 'install' });
    store.enqueue({ type: 'capture', dependsOn: [install.id] });

    const r = checkEnqueueGuards(ctx, { type: 'report', reason: 'x' });

    expect(r).toMatchObject({ ok: false, guard: 'sink-closure' });
    expect(r.ok === false && r.message).toContain(
      'a task already in dependsOn',
    );
  });

  it('the guard is what keeps the seeded task at the end of the drain', () => {
    // Without it: install depends on warehouse, the resolver drops install and
    // everything downstream, and warehouse runs alone in the first tier.
    const warehouse = store.enqueue({ type: 'warehouse', optional: true });
    const rejected = checkEnqueueGuards(ctx, {
      type: 'install',
      dependsOn: [warehouse.id],
      reason: 'x',
    });
    expect(rejected.ok).toBe(false);

    // With the edge refused, the planner queues install unattached, and the
    // deferral puts warehouse where it belongs.
    const install = store.enqueue({ type: 'install' });
    const capture = store.enqueue({ type: 'capture', dependsOn: [install.id] });
    store.enqueue({ type: 'report', dependsOn: [capture.id, warehouse.id] });
    const deferred = seededDependencies(store, warehouse.id, [], SINKS);
    store.addDependencies(warehouse.id, deferred.depIds);

    const tiers: string[][] = [];
    for (;;) {
      const runnable = store.nextRunnable();
      if (runnable.length === 0) break;
      tiers.push(runnable.map((t) => t.type).sort());
      for (const t of runnable) {
        store.start(t.id);
        store.complete(t.id);
      }
    }
    expect(tiers).toEqual([
      ['install'],
      ['capture'],
      ['warehouse'],
      ['report'],
    ]);
  });
});
