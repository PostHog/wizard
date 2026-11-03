import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('@utils/analytics', () => ({
  analytics: { wizardCapture: vi.fn(), captureException: vi.fn() },
}));

import { QueueStore } from '@agent/runner/sequence/orchestrator/queue';
import {
  graphDiff,
  graphsAgree,
  typedEdges,
  type TaskGraph,
} from '@agent/runner/sequence/orchestrator/task-graph';

function newStore(): QueueStore {
  return new QueueStore(
    fs.mkdtempSync(path.join(os.tmpdir(), 'task-graph-')),
    'run',
  );
}

const CHAIN: TaskGraph = {
  sink: 'report',
  excluded: [],
  nodes: {
    install: { dependsOn: [], picked: true },
    init: { dependsOn: [], picked: true },
    capture: { dependsOn: ['install', 'init'] },
    report: { dependsOn: ['capture'] },
  },
};

describe('typedEdges', () => {
  it('splices an unqueued dependency into its own dependencies', () => {
    const store = newStore();
    const init = store.enqueue({ type: 'init' });
    const capture = store.enqueue({ type: 'capture' });
    const report = store.enqueue({ type: 'report' });
    const edges = typedEdges(store, CHAIN);
    expect(edges.get(capture.id)).toEqual([init.id]);
    expect(edges.get(report.id)).toEqual([capture.id]);
  });

  it('pairs a fanned-out chain by its inputs', () => {
    const graph: TaskGraph = {
      sink: 'report',
      excluded: [],
      nodes: {
        verify: { dependsOn: [], picked: true },
        instrument: {
          dependsOn: ['verify'],
          picked: true,
          matchInputs: ['service_name'],
        },
        report: { dependsOn: ['instrument'] },
      },
    };
    const store = newStore();
    const api = { service_name: 'api' };
    const worker = { service_name: 'worker' };
    const verifyApi = store.enqueue({ type: 'verify', inputs: api });
    const verifyWorker = store.enqueue({ type: 'verify', inputs: worker });
    const instrumentApi = store.enqueue({ type: 'instrument', inputs: api });
    const instrumentWorker = store.enqueue({
      type: 'instrument',
      inputs: worker,
    });
    const report = store.enqueue({ type: 'report' });
    const edges = typedEdges(store, graph);
    expect(edges.get(instrumentApi.id)).toEqual([verifyApi.id]);
    expect(edges.get(instrumentWorker.id)).toEqual([verifyWorker.id]);
    expect(edges.get(report.id)).toEqual([
      instrumentApi.id,
      instrumentWorker.id,
    ]);
  });
});

describe('graphDiff', () => {
  it('agrees with a planner graph that has redundant edges', () => {
    const store = newStore();
    const install = store.enqueue({ type: 'install' });
    const init = store.enqueue({ type: 'init' });
    const capture = store.enqueue({
      type: 'capture',
      dependsOn: [install.id, init.id],
    });
    store.enqueue({ type: 'report', dependsOn: [capture.id, install.id] });
    expect(graphsAgree(graphDiff(store, CHAIN))).toBe(true);
  });

  it('catches a fanned-out task wired to the wrong sibling', () => {
    const graph: TaskGraph = {
      sink: 'report',
      excluded: [],
      nodes: {
        verify: { dependsOn: [], picked: true },
        instrument: {
          dependsOn: ['verify'],
          picked: true,
          matchInputs: ['service_name'],
        },
        report: { dependsOn: ['instrument'] },
      },
    };
    const store = newStore();
    const api = { service_name: 'api' };
    const worker = { service_name: 'worker' };
    const verifyApi = store.enqueue({ type: 'verify', inputs: api });
    store.enqueue({ type: 'verify', inputs: worker });
    const instrumentWorker = store.enqueue({
      type: 'instrument',
      inputs: worker,
      dependsOn: [verifyApi.id],
    });
    store.enqueue({ type: 'report', dependsOn: [instrumentWorker.id] });
    expect(graphDiff(store, graph).edges).toContainEqual({
      type: 'instrument',
      missing: ['verify'],
      extra: ['verify'],
    });
  });

  it('names a dropped edge, a missing node and an extra one', () => {
    const store = newStore();
    store.enqueue({ type: 'install' });
    store.enqueue({ type: 'report' });
    store.enqueue({ type: 'invented' });
    expect(graphDiff(store, CHAIN)).toEqual({
      missingTypes: ['capture'],
      extraTypes: ['invented'],
      edges: [{ type: 'report', missing: ['install'], extra: [] }],
    });
  });
});

describe('QueueStore.replaceDependencies', () => {
  it('rewires the queue to the typed graph', () => {
    const store = newStore();
    const install = store.enqueue({ type: 'install' });
    const init = store.enqueue({ type: 'init' });
    const capture = store.enqueue({ type: 'capture' });
    const report = store.enqueue({ type: 'report' });
    expect(store.replaceDependencies(typedEdges(store, CHAIN))).toEqual({
      applied: true,
    });
    expect(store.get(capture.id)?.dependsOn).toEqual([install.id, init.id]);
    expect(store.get(report.id)?.dependsOn).toEqual([capture.id]);
    expect(graphsAgree(graphDiff(store, CHAIN))).toBe(true);
  });

  it('refuses a cycle and changes nothing', () => {
    const store = newStore();
    const a = store.enqueue({ type: 'a' });
    const b = store.enqueue({ type: 'b', dependsOn: [a.id] });
    const result = store.replaceDependencies(new Map([[a.id, [b.id]]]));
    expect(result).toEqual({ applied: false, reason: 'cycle' });
    expect(store.get(a.id)?.dependsOn).toEqual([]);
  });

  it('refuses to rewire a task that already started', () => {
    const store = newStore();
    const a = store.enqueue({ type: 'a' });
    const b = store.enqueue({ type: 'b' });
    store.start(b.id);
    expect(store.replaceDependencies(new Map([[b.id, [a.id]]])).applied).toBe(
      false,
    );
  });
});
