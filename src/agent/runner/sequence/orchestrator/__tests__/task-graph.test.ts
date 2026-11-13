/** Queueing a flow from its frontmatter: the order, the tasks a run leaves out, and the sink. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn() },
}));
vi.mock('@utils/debug', async (importActual) => ({
  ...(await importActual<typeof import('@utils/debug')>()),
  logToFile: vi.fn(),
}));

import { logToFile } from '@utils/debug';
import type { GraphTask } from '../../../../agent-prompt-loader';
import { QueueStore } from '../queue';
import type { OrchestratorToolsContext } from '../queue-tools';
import { planTaskGraph, queueTaskGraph } from '../task-graph';

const task = (
  type: string,
  dependsOn: string[] = [],
  sink = false,
): GraphTask => ({ type, dependsOn, sink });

const GRAPH = [
  task('report', ['dashboard', 'review'], true),
  task('review', ['install', 'capture', 'logs']),
  task('dashboard', ['capture']),
  task('logs', ['observability']),
  task('observability', ['capture']),
  task('capture', ['install']),
  task('install'),
];

const all = () => true;
const without =
  (...dropped: string[]) =>
  (type: string) =>
    !dropped.includes(type);
const edges = (plan: ReturnType<typeof planTaskGraph>) =>
  Object.fromEntries(plan.map((t) => [t.type, t.dependsOn]));

describe('planTaskGraph', () => {
  it('places every task after the tasks it waits for, and the sink last', () => {
    const plan = planTaskGraph(GRAPH, all);
    expect(plan.map((t) => t.type)).toEqual([
      'install',
      'capture',
      'dashboard',
      'observability',
      'logs',
      'review',
      'report',
    ]);
    expect(edges(plan)).toMatchObject({
      install: [],
      review: ['install', 'capture', 'logs'],
      report: ['dashboard', 'review'],
    });
  });

  it("gives a dropped task's dependencies to the tasks that waited on it", () => {
    const plan = planTaskGraph(GRAPH, without('observability'));
    expect(plan.map((t) => t.type)).not.toContain('observability');
    expect(edges(plan).logs).toEqual(['capture']);
  });

  it('reads through a chain of dropped tasks, naming each dependency once', () => {
    const plan = planTaskGraph(GRAPH, without('observability', 'logs'));
    expect(edges(plan).review).toEqual(['install', 'capture']);
  });

  it('ignores a dependency the flow does not declare', () => {
    const plan = planTaskGraph(
      [task('install', ['no-such-task']), task('report', ['install'], true)],
      all,
    );
    expect(edges(plan)).toEqual({ install: [], report: ['install'] });
  });

  it('keeps a sink last when it declares no dependencies', () => {
    const plan = planTaskGraph(
      [task('report', [], true), task('install'), task('capture')],
      all,
    );
    expect(plan.map((t) => t.type)).toEqual(['install', 'capture', 'report']);
  });

  it('throws on tasks that wait on each other', () => {
    expect(() =>
      planTaskGraph([task('a', ['b']), task('b', ['a'])], all),
    ).toThrow(/cannot be ordered: a, b/);
  });

  it('stops at a cycle among the dropped tasks', () => {
    const plan = planTaskGraph(
      [task('a', ['b']), task('b', ['c']), task('c', ['b']), task('d')],
      without('b', 'c'),
    );
    expect(edges(plan)).toEqual({ a: [], d: [] });
  });
});

describe('queueTaskGraph', () => {
  let dir: string;
  let store: QueueStore;
  let ctx: OrchestratorToolsContext;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-graph-test-'));
    store = new QueueStore(dir, 'run-1');
    ctx = {
      store,
      validTypes: GRAPH.map((t) => t.type),
      sinkTypes: ['report'],
      runnerSeededTypes: ['warehouse'],
      optionalTypes: ['observability', 'logs'],
    };
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const typesOf = (ids: readonly string[]) =>
    ids.map((id) => store.get(id)?.type);
  const queued = (type: string) => store.list().find((t) => t.type === type);

  it('queues each task with the ids of the tasks it waits for', () => {
    queueTaskGraph(ctx, GRAPH);
    expect(store.list().map((t) => t.type)).toEqual([
      'install',
      'capture',
      'dashboard',
      'observability',
      'logs',
      'review',
      'report',
    ]);
    expect(typesOf(queued('review')?.dependsOn ?? [])).toEqual([
      'install',
      'capture',
      'logs',
    ]);
    expect(queued('install')?.enqueuedBy).toBe('orchestrator');
  });

  it("marks optional tasks from the flow's own list", () => {
    queueTaskGraph(ctx, GRAPH);
    expect(queued('logs')?.optional).toBe(true);
    expect(queued('capture')?.optional).toBeUndefined();
  });

  it('leaves out the types the run excludes and keeps the order around them', () => {
    queueTaskGraph(
      { ...ctx, validTypes: ctx.validTypes.filter((t) => t !== 'dashboard') },
      GRAPH,
    );
    expect(queued('dashboard')).toBeUndefined();
    expect(typesOf(queued('report')?.dependsOn ?? [])).toEqual([
      'capture',
      'review',
    ]);
  });

  it('makes the sink wait for a task the wizard queued first, and nothing else', () => {
    const warehouse = store.enqueue({ type: 'warehouse', optional: true });
    queueTaskGraph(ctx, [...GRAPH, task('warehouse')]);
    expect(queued('report')?.dependsOn).toContain(warehouse.id);
    const others = store
      .list()
      .filter((t) => t.type !== 'report' && t.dependsOn.includes(warehouse.id));
    expect(others).toEqual([]);
  });

  it('makes a sink with no declared dependencies wait for the whole queue', () => {
    queueTaskGraph({ ...ctx, validTypes: ['install', 'capture', 'report'] }, [
      task('report', [], true),
      task('install'),
      task('capture'),
    ]);
    expect(typesOf(queued('report')?.dependsOn ?? [])).toEqual([
      'install',
      'capture',
    ]);
  });

  it('logs a dependency the flow does not declare, once', () => {
    queueTaskGraph({ ...ctx, validTypes: ['install', 'capture', 'report'] }, [
      task('report', ['install', 'capture'], true),
      task('install', ['logs']),
      task('capture', ['logs']),
      task('logs', ['no-such-task']),
    ]);
    const lines = vi
      .mocked(logToFile)
      .mock.calls.filter(([line]) => String(line).includes('no-such-task'));
    expect(lines).toHaveLength(1);
  });

  it('throws when a guard rejects a task', () => {
    store.enqueue({ type: 'install' });
    expect(() => queueTaskGraph(ctx, GRAPH)).toThrow(
      /Cannot queue "install" from the flow's frontmatter \(dedup\)/,
    );
  });
});
