import { RunOutcome } from '@agent';
import type { RunResult } from '@agent/types';
import type { Credentials } from '@shared/api';
import { Harness, Sequence } from '@shared/constants';
import { ErrorCodes } from '@shared/errors';
import {
  ProgramStore,
  type ProgramDataProgress,
  type ProgramRunProgress,
} from '../program-store';

it('forwards attributed copies of run events and settles the original result', () => {
  const store = new ProgramStore();
  const observed: ProgramRunProgress[] = [];
  const run = store.beginRun(
    { runId: 'run-1', stepId: 'install' },
    (progress) => {
      observed.push(progress);
      if (progress.event.kind === 'tasks') {
        progress.event.tasks[0].content = 'observer changed this';
      }
    },
  );
  const tasks = [{ content: 'Install', status: 'completed' as const }];

  run.onProgress({ kind: 'tasks', tasks });
  run.onProgress({
    kind: 'url',
    which: 'notebook',
    url: 'https://us.posthog.com/notebook/7',
  });

  expect(tasks[0].content).toBe('Install');
  expect(
    observed.map(({ runId, stepId, event }) => [runId, stepId, event.kind]),
  ).toEqual([
    ['run-1', 'install', 'tasks'],
    ['run-1', 'install', 'url'],
  ]);
  expect(store.activeNotebookUrl()).toBe('https://us.posthog.com/notebook/7');

  const result = {
    outcome: RunOutcome.Crashed,
    failure: {
      code: ErrorCodes.InternalUnhandled,
      message: 'Connection failed',
    },
  } as RunResult;
  run.finish(result);
  run.onProgress({ kind: 'status', message: 'late' });

  expect(store.activeNotebookUrl()).toBeUndefined();
  expect(store.settledRuns()).toEqual([
    { runId: 'run-1', stepId: 'install', result },
  ]);
  expect(store.settledRuns()[0].result).toBe(result);
  expect(observed).toHaveLength(2);
  expect(store.readDiagnostics()).toEqual([
    { runId: 'run-1', eventKind: 'status', message: 'progress after finish' },
  ]);
});

it('does not wait for an observer, and records its failures as diagnostics', async () => {
  let rejectObserver!: (reason: Error) => void;
  const observer = vi.fn(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectObserver = reject;
      }),
  );
  const onData = vi.fn().mockImplementationOnce(() => {
    throw new Error('observer threw');
  });
  const store = new ProgramStore({ onData });
  const run = store.beginRun(
    { runId: 'run-1' },
    observer as (progress: ProgramRunProgress) => void,
  );

  expect(run.onProgress({ kind: 'status', message: 'First' })).toBeUndefined();
  store.markProgramCompleted('integrate-run');
  rejectObserver(new Error('delivery failed'));

  expect(store.readData().composition.completedRuns).toEqual(['integrate-run']);
  await vi.waitFor(() => {
    expect(store.readDiagnostics()).toEqual([
      { eventKind: 'data', message: 'observer threw' },
      { runId: 'run-1', eventKind: 'status', message: 'delivery failed' },
    ]);
  });
});

it('copies invocation data on write, on read and in each emitted snapshot', () => {
  const observed: ProgramDataProgress[] = [];
  const store = new ProgramStore({
    onData: (progress) => observed.push(progress),
  });
  const credentials = {
    accessToken: 'test-access-token',
    projectApiKey: 'test-project-key',
    projectId: 42,
    host: { region: 'us', apiHost: 'https://example.test' },
  } as Credentials;
  const frameworkValue = { paths: ['apps/web'] };
  const binding = {
    sequence: Sequence.linear,
    harness: Harness.anthropic,
    model: 'claude-test',
  };

  store.setAuthenticated({ credentials, apiProject: null, apiUser: null });
  store.setFrameworkContext('selectedProject', frameworkValue);
  store.setEventPlan([{ name: 'signup', description: 'Account created' }]);
  store.setComposition({ parentProgramId: 'self-driving' });
  store.markProgramCompleted('integrate-run');
  store.setBinding(binding);
  const written = store.readData();
  credentials.accessToken = 'changed input';
  frameworkValue.paths.push('changed input');
  binding.model = 'changed input';
  observed[5].data.eventPlan[0].name = 'changed by observer';
  store.readData().composition.completedRuns.push('changed output');

  expect(observed).toHaveLength(6);
  expect(observed[0].data.eventPlan).toEqual([]);
  expect(store.readData()).toEqual(written);
  expect(written).toMatchObject({
    credentials: { accessToken: 'test-access-token' },
    detection: {
      frameworkContext: { selectedProject: { paths: ['apps/web'] } },
    },
    eventPlan: [{ name: 'signup', description: 'Account created' }],
    composition: {
      parentProgramId: 'self-driving',
      completedRuns: ['integrate-run'],
    },
    binding: { model: 'claude-test' },
  });
});
