/**
 * Where a runner-seeded task lands in the planner's graph.
 *
 * The task is queued before the planner runs, so it has no dependencies at
 * enqueue and would otherwise run in the first drain tier — for the warehouse
 * step, that means credential prompts arriving while the coding tasks are still
 * writing files. These cover the resolution that moves it to the end.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn(), captureException: vi.fn() },
}));

import {
  QueueStore,
  type QueuedTask,
} from '@lib/agent/runner/sequence/orchestrator/queue';
import {
  deferSeededTasks,
  seededDependencies,
} from '@lib/agent/runner/sequence/orchestrator/seeded-deps';

const SINKS = ['report'];

/**
 * The real integration-v2 graph: the seeded warehouse task first (as the runner
 * queues it), then the shape the planner builds around it.
 */
function plannedQueue(store: QueueStore): {
  warehouse: QueuedTask;
  byType: Record<string, QueuedTask>;
} {
  const warehouse = store.enqueue({ type: 'warehouse', optional: true });
  const install = store.enqueue({ type: 'install' });
  const init = store.enqueue({ type: 'init' });
  const identify = store.enqueue({
    type: 'identify',
    dependsOn: [install.id, init.id],
  });
  const errorTracking = store.enqueue({
    type: 'error-tracking',
    dependsOn: [install.id, init.id],
  });
  const capture = store.enqueue({ type: 'capture', dependsOn: [identify.id] });
  const review = store.enqueue({
    type: 'review',
    dependsOn: [install.id, init.id, identify.id, errorTracking.id, capture.id],
  });
  const dashboard = store.enqueue({
    type: 'dashboard',
    dependsOn: [capture.id],
  });
  // The sink waits for everything, the seeded task included — the planner is
  // told to, and the sink-closure guard enforces it.
  const report = store.enqueue({
    type: 'report',
    dependsOn: [dashboard.id, review.id, warehouse.id],
  });
  return {
    warehouse,
    byType: {
      install,
      init,
      identify,
      'error-tracking': errorTracking,
      capture,
      review,
      dashboard,
      report,
    },
  };
}

describe('seededDependencies', () => {
  let dir: string;
  let store: QueueStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seeded-deps-test-'));
    store = new QueueStore(dir, 'run-1');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  describe('with types declared in frontmatter', () => {
    it('resolves the declared types to the planner’s ids', () => {
      const { warehouse, byType } = plannedQueue(store);

      const result = seededDependencies(
        store,
        warehouse.id,
        ['review', 'dashboard'],
        SINKS,
      );

      expect(result.declared).toBe(true);
      expect(result.depIds.sort()).toEqual(
        [byType.review.id, byType.dashboard.id].sort(),
      );
      expect(result.unresolvedTypes).toEqual([]);
    });

    it('waits for every task of a fanned-out type, not just the first', () => {
      const warehouse = store.enqueue({ type: 'warehouse' });
      const first = store.enqueue({ type: 'capture' });
      const second = store.enqueue({ type: 'capture' });

      const result = seededDependencies(
        store,
        warehouse.id,
        ['capture'],
        SINKS,
      );

      expect(result.depIds.sort()).toEqual([first.id, second.id].sort());
    });

    it('drops a declared type the planner never queued, and names it', () => {
      const { warehouse, byType } = plannedQueue(store);

      const result = seededDependencies(
        store,
        warehouse.id,
        ['review', 'migrate'],
        SINKS,
      );

      expect(result.depIds).toEqual([byType.review.id]);
      expect(result.unresolvedTypes).toEqual(['migrate']);
    });

    it('never takes a sink as a dependency, even when one is declared', () => {
      const { warehouse, byType } = plannedQueue(store);

      const result = seededDependencies(store, warehouse.id, ['report'], SINKS);

      expect(result.depIds).toEqual([]);
      // The sink was queued, so it resolved — it is just not usable as an edge.
      expect(result.unresolvedTypes).toEqual([]);
      expect(result.depIds).not.toContain(byType.report.id);
    });
  });

  describe('with no types declared', () => {
    it('waits for every task that is not the sink', () => {
      const { warehouse, byType } = plannedQueue(store);

      const result = seededDependencies(store, warehouse.id, [], SINKS);

      expect(result.declared).toBe(false);
      expect(result.depIds.sort()).toEqual(
        [
          byType.install.id,
          byType.init.id,
          byType.identify.id,
          byType['error-tracking'].id,
          byType.capture.id,
          byType.review.id,
          byType.dashboard.id,
        ].sort(),
      );
    });

    it('leaves the sink out, so a planner that forgot the edge is still caught', () => {
      const { warehouse, byType } = plannedQueue(store);

      const result = seededDependencies(store, warehouse.id, [], SINKS);

      expect(result.depIds).not.toContain(byType.report.id);
    });

    it('never depends on itself', () => {
      const { warehouse } = plannedQueue(store);

      const result = seededDependencies(store, warehouse.id, [], SINKS);

      expect(result.depIds).not.toContain(warehouse.id);
    });
  });

  describe('cycle safety', () => {
    it('excludes a non-sink task the planner hung off the seeded task', () => {
      const warehouse = store.enqueue({ type: 'warehouse' });
      const install = store.enqueue({ type: 'install' });
      // Downstream of the seeded task: depending on it back would close a loop.
      const downstream = store.enqueue({
        type: 'capture',
        dependsOn: [warehouse.id],
      });

      const result = seededDependencies(store, warehouse.id, [], SINKS);

      expect(result.depIds).toEqual([install.id]);
      expect(result.depIds).not.toContain(downstream.id);
    });

    it('excludes a transitively downstream task', () => {
      const warehouse = store.enqueue({ type: 'warehouse' });
      const mid = store.enqueue({ type: 'capture', dependsOn: [warehouse.id] });
      const far = store.enqueue({ type: 'review', dependsOn: [mid.id] });

      const result = seededDependencies(store, warehouse.id, [], SINKS);

      expect(result.depIds).toEqual([]);
      expect(result.depIds).not.toContain(far.id);
    });

    it('refuses a declared type that is downstream rather than inverting it', () => {
      const warehouse = store.enqueue({ type: 'warehouse' });
      store.enqueue({ type: 'review', dependsOn: [warehouse.id] });

      const result = seededDependencies(store, warehouse.id, ['review'], SINKS);

      expect(result.depIds).toEqual([]);
      expect(result.unresolvedTypes).toEqual([]);
    });
  });

  it('returns nothing for a queue holding only the seeded task', () => {
    const warehouse = store.enqueue({ type: 'warehouse' });

    expect(seededDependencies(store, warehouse.id, [], SINKS)).toEqual({
      depIds: [],
      unresolvedTypes: [],
      declared: false,
    });
  });
});

/**
 * The wiring the runner uses: each seeded task's own prompt supplies its declared
 * types, and the edges land on the queue.
 */
describe('deferSeededTasks', () => {
  let dir: string;
  let store: QueueStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'defer-seeded-test-'));
    store = new QueueStore(dir, 'run-1');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  /**
   * A prompt that declares its own position. No shipped flow does today —
   * integration-v2's warehouse agent leaves `dependsOn` empty and takes the
   * default — but the mechanism is generic, so it is covered here for the
   * seeded task that eventually needs a shallower position than "last".
   */
  const declaredTypesFor = (type: string) =>
    type === 'warehouse' ? ['review', 'dashboard'] : [];

  it('applies the prompt’s declared types to the queue', () => {
    const { warehouse, byType } = plannedQueue(store);

    const [entry] = deferSeededTasks(
      store,
      [warehouse],
      declaredTypesFor,
      SINKS,
    );

    expect(entry).toMatchObject({
      type: 'warehouse',
      declared: true,
      declaredTypes: ['review', 'dashboard'],
      refused: [],
      unresolvedTypes: [],
    });
    expect(store.get(warehouse.id)?.dependsOn.sort()).toEqual(
      [byType.review.id, byType.dashboard.id].sort(),
    );
  });

  it('moves the seeded task out of the first drain tier', () => {
    const { warehouse } = plannedQueue(store);
    expect(store.nextRunnable().map((t) => t.type)).toContain('warehouse');

    deferSeededTasks(store, [warehouse], declaredTypesFor, SINKS);

    expect(store.nextRunnable().map((t) => t.type)).not.toContain('warehouse');
    expect(
      store
        .nextRunnable()
        .map((t) => t.type)
        .sort(),
    ).toEqual(['init', 'install']);
  });

  it('falls back to the default when the prompt declares nothing', () => {
    const { warehouse, byType } = plannedQueue(store);

    const [entry] = deferSeededTasks(store, [warehouse], () => [], SINKS);

    expect(entry.declared).toBe(false);
    expect(entry.added).toHaveLength(7);
    expect(store.get(warehouse.id)?.dependsOn).not.toContain(byType.report.id);
  });

  it('does nothing when the run seeded no task', () => {
    plannedQueue(store);
    expect(deferSeededTasks(store, [], declaredTypesFor, SINKS)).toEqual([]);
  });

  it('handles several seeded tasks independently', () => {
    const warehouse = store.enqueue({ type: 'warehouse', optional: true });
    const other = store.enqueue({ type: 'migrate', optional: true });
    const install = store.enqueue({ type: 'install' });
    const review = store.enqueue({ type: 'review', dependsOn: [install.id] });
    const dashboard = store.enqueue({ type: 'dashboard' });

    const entries = deferSeededTasks(
      store,
      [warehouse, other],
      declaredTypesFor,
      SINKS,
    );

    expect(entries.map((e) => e.type)).toEqual(['warehouse', 'migrate']);
    // warehouse took its declared types; migrate declared none, so it waits for
    // everything non-sink — the other seeded task included.
    expect(store.get(warehouse.id)?.dependsOn.sort()).toEqual(
      [review.id, dashboard.id].sort(),
    );
    expect(store.get(other.id)?.dependsOn).toContain(install.id);
    expect(store.get(other.id)?.dependsOn).toContain(warehouse.id);
  });
});

/**
 * The half of #1103 this change keeps.
 *
 * Consent moved back to seed time; execution did not. The warehouse step still
 * runs last, after every coding task, because that is where its credential
 * questions belong. These drain the whole planned graph and assert the order the
 * user actually experiences, so a future change that answers the notice early
 * cannot quietly drag the work forward with it.
 */
describe('execution still happens last', () => {
  let dir: string;
  let store: QueueStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seeded-order-test-'));
    store = new QueueStore(dir, 'run-1');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  /** Run the graph to completion, tier by tier, recording the order. */
  const drain = (): string[][] => {
    const tiers: string[][] = [];
    for (let guard = 0; guard < 20; guard += 1) {
      const runnable = store.nextRunnable();
      if (runnable.length === 0) break;
      tiers.push(runnable.map((t) => t.type).sort());
      for (const task of runnable) {
        store.start(task.id);
        store.complete(task.id);
      }
    }
    return tiers;
  };

  it('leaves the seeded task in the last tier before the sink', () => {
    const { warehouse } = plannedQueue(store);
    deferSeededTasks(store, [warehouse], () => [], SINKS);

    const tiers = drain();

    expect(tiers.at(-1)).toEqual(['report']);
    expect(tiers.at(-2)).toEqual(['warehouse']);
    expect(tiers[0]).toEqual(['init', 'install']);
  });

  it('runs every coding task before the seeded one, whatever order they finish in', () => {
    const { warehouse } = plannedQueue(store);
    deferSeededTasks(store, [warehouse], () => [], SINKS);

    const order = drain().flat();
    const warehouseAt = order.indexOf('warehouse');

    for (const type of [
      'install',
      'init',
      'identify',
      'error-tracking',
      'capture',
      'review',
      'dashboard',
    ]) {
      expect(order.indexOf(type)).toBeLessThan(warehouseAt);
    }
    expect(order.indexOf('report')).toBeGreaterThan(warehouseAt);
  });

  it('is not pulled forward by a task that was answered but not yet run', () => {
    // Consent is taken at seed time, before the planner runs. The task is still
    // an ordinary pending task at that point, so the deferral applies to it
    // exactly as it did before the answer existed.
    const { warehouse } = plannedQueue(store);
    expect(store.get(warehouse.id)?.status).toBe('pending');

    deferSeededTasks(store, [warehouse], () => [], SINKS);

    expect(store.get(warehouse.id)?.dependsOn).toHaveLength(7);
    expect(store.nextRunnable().map((t) => t.type)).not.toContain('warehouse');
  });
});
