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

import { QueueStore } from '@lib/agent/runner/sequence/orchestrator/queue';
import { displayOrder } from '@lib/agent/runner/sequence/orchestrator/orchestrator-runner';
import {
  applyEnqueue,
  checkEnqueueGuards,
  dependencyClosure,
  uncoveredBySink,
  type OrchestratorToolsContext,
} from '@lib/agent/runner/sequence/orchestrator/queue-tools';

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
    // The optional task still has nothing to wait for, so it starts at once.
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
