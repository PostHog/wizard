import { RunOutcome } from '@agent';
import type { RunResult } from '@agent/types';
import { ProgramStore, type ProgramProgress } from '../program-store';

function success(snapshot: RunResult['snapshot'], skillId?: string): RunResult {
  return { outcome: RunOutcome.Success, snapshot, skillId };
}

it('projects progress before forwarding copied events in emission order', () => {
  const store = new ProgramStore();
  const observed: Array<{ kind: string; status: string[]; stepId?: string }> =
    [];
  const run = store.beginRun(
    { runId: 'run-1', stepId: 'install' },
    (progress) => {
      observed.push({
        kind: progress.event.kind,
        status: store.read().runs[0]?.snapshot.statusMessages ?? [],
        stepId: progress.stepId,
      });
      if (progress.event.kind === 'tasks') {
        progress.event.tasks[0].content = 'observer changed this';
      }
    },
  );

  expect(
    run.onProgress({ kind: 'lifecycle', phase: 'started' }),
  ).toBeUndefined();
  run.onProgress({ kind: 'status', message: 'Installing' });
  run.onProgress({
    kind: 'tasks',
    tasks: [{ content: 'Install', status: 'completed' }],
  });
  run.onProgress({
    kind: 'usage',
    delta: {
      inputTokens: 2,
      outputTokens: 3,
      cacheReadTokens: 4,
      cacheCreationTokens: 5,
      cacheCreation5m: 5,
      cacheCreation1h: 0,
    },
  });
  run.onProgress({
    kind: 'url',
    which: 'dashboard',
    url: 'https://example.com/dashboard',
  });

  expect(observed).toEqual([
    { kind: 'lifecycle', status: [], stepId: 'install' },
    { kind: 'status', status: ['Installing'], stepId: 'install' },
    { kind: 'tasks', status: ['Installing'], stepId: 'install' },
    { kind: 'usage', status: ['Installing'], stepId: 'install' },
    { kind: 'url', status: ['Installing'], stepId: 'install' },
  ]);
  expect(store.read().runs[0]).toMatchObject({
    runId: 'run-1',
    phase: 'running',
    snapshot: {
      tasks: [{ content: 'Install', status: 'completed' }],
      statusMessages: ['Installing'],
      usage: {
        inputTokens: 2,
        outputTokens: 3,
        cacheReadTokens: 4,
        cacheCreationTokens: 5,
      },
      dashboardUrl: 'https://example.com/dashboard',
    },
  });
  const readCopy = store.read();
  readCopy.runs[0].snapshot.tasks[0].content = 'external mutation';
  expect(store.read().runs[0].snapshot.tasks[0].content).toBe('Install');
});

it('does not wait for an observer or let its failure break the projection', async () => {
  const store = new ProgramStore();
  let rejectObserver!: (reason: Error) => void;
  const pending = new Promise<void>((_resolve, reject) => {
    rejectObserver = reject;
  });
  const observer = vi.fn(() => pending);
  const run = store.beginRun(
    { runId: 'run-1' },
    observer as (progress: ProgramProgress) => void,
  );

  expect(run.onProgress({ kind: 'status', message: 'First' })).toBeUndefined();
  expect(run.onProgress({ kind: 'status', message: 'Second' })).toBeUndefined();
  expect(observer).toHaveBeenCalledTimes(2);
  expect(store.read().runs[0].snapshot.statusMessages).toEqual([
    'First',
    'Second',
  ]);

  rejectObserver(new Error('delivery failed'));
  await vi.waitFor(() => {
    expect(store.read().diagnostics).toContainEqual({
      runId: 'run-1',
      eventKind: 'status',
      message: 'delivery failed',
    });
  });
});

it('reconciles from final agent results and retains run registration order', () => {
  const store = new ProgramStore();
  const first = store.beginRun({ runId: 'first' });
  const second = store.beginRun({ runId: 'second', stepId: 'follow-up' });
  first.onProgress({ kind: 'status', message: 'partial' });
  first.onProgress({
    kind: 'url',
    which: 'dashboard',
    url: 'https://stale.example',
  });

  const firstResult = success(
    {
      tasks: [{ content: 'Done', status: 'completed' }],
      statusMessages: ['Final status'],
      stage: 'Report',
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 30,
        cacheCreationTokens: 40,
      },
      finalCostUsd: 1.25,
      dashboardUrl: 'https://example.com/final-dashboard',
      handoffText: '# Handoff',
    },
    'integration',
  );
  const secondResult: RunResult = {
    outcome: RunOutcome.Aborted,
    failure: { message: 'Cancelled by user' },
    snapshot: {
      tasks: [],
      statusMessages: [],
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
    },
  };
  second.finish(secondResult);
  first.finish(firstResult);

  expect(store.read().runs).toMatchObject([
    {
      runId: 'first',
      phase: 'finished',
      outcome: RunOutcome.Success,
      skillId: 'integration',
      snapshot: firstResult.snapshot,
    },
    {
      runId: 'second',
      stepId: 'follow-up',
      phase: 'finished',
      outcome: RunOutcome.Aborted,
      snapshot: secondResult.snapshot,
    },
  ]);
  expect(store.results()).toEqual([firstResult, secondResult]);
});

it('keeps completed results detached from both the input and returned copies', () => {
  const store = new ProgramStore();
  const run = store.beginRun({ runId: 'one' });
  const result = success({
    tasks: [{ content: 'Original task', status: 'completed' }],
    statusMessages: ['Original status'],
    usage: {
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 3,
      cacheCreationTokens: 4,
    },
  });
  run.finish(result);

  result.snapshot.tasks[0].content = 'Changed input';
  result.snapshot.statusMessages.push('Changed input');
  expect(store.results()[0].snapshot).toMatchObject({
    tasks: [{ content: 'Original task' }],
    statusMessages: ['Original status'],
  });

  const returned = store.results()[0];
  returned.snapshot.tasks[0].content = 'Changed output';
  returned.snapshot.statusMessages.push('Changed output');
  expect(store.results()[0].snapshot).toMatchObject({
    tasks: [{ content: 'Original task' }],
    statusMessages: ['Original status'],
  });
});

it('keeps crash errors detached without losing their type or metadata', () => {
  class GatewayFailure extends Error {
    code = 'gateway_unavailable';
  }
  const store = new ProgramStore();
  const run = store.beginRun({ runId: 'crashed' });
  const error = new GatewayFailure('Connection failed');
  const snapshot: RunResult['snapshot'] = {
    tasks: [],
    statusMessages: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    },
  };
  const result: RunResult = {
    outcome: RunOutcome.Crashed,
    failure: { error },
    snapshot,
  };
  run.finish(result);

  error.code = 'changed_input';
  const stored = store.results()[0];
  expect(stored.outcome).toBe(RunOutcome.Crashed);
  if (stored.outcome !== RunOutcome.Crashed)
    throw new Error('Expected crashed result');
  expect(stored.failure.error).toBeInstanceOf(GatewayFailure);
  expect((stored.failure.error as GatewayFailure).code).toBe(
    'gateway_unavailable',
  );
  (stored.failure.error as GatewayFailure).code = 'changed_output';
  const reread = store.results()[0];
  if (reread.outcome !== RunOutcome.Crashed)
    throw new Error('Expected crashed result');
  expect((reread.failure.error as GatewayFailure).code).toBe(
    'gateway_unavailable',
  );
});
