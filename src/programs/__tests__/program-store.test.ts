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
  const run = store.beginRun('run-1', (progress) => {
    observed.push(progress);
    if (progress.event.kind === 'tasks') {
      progress.event.tasks[0].content = 'observer changed this';
    }
  });
  const tasks = [{ content: 'Install', status: 'completed' as const }];

  run.onProgress({ kind: 'tasks', tasks });
  run.onProgress({
    kind: 'url',
    which: 'notebook',
    url: 'https://us.posthog.com/notebook/7',
  });

  expect(tasks[0].content).toBe('Install');
  expect(observed.map(({ runId, event }) => [runId, event.kind])).toEqual([
    ['run-1', 'tasks'],
    ['run-1', 'url'],
  ]);

  const result = {
    outcome: RunOutcome.Crashed,
    failure: {
      code: ErrorCodes.InternalUnhandled,
      message: 'Connection failed',
    },
  } as RunResult;
  run.finish(result);
  run.onProgress({ kind: 'status', message: 'late' });

  expect(store.settledRuns()).toEqual([{ runId: 'run-1', result }]);
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
    'run-1',
    observer as (progress: ProgramRunProgress) => void,
  );

  expect(run.onProgress({ kind: 'status', message: 'First' })).toBeUndefined();
  store.setAiSdkStampReported();
  rejectObserver(new Error('delivery failed'));

  expect(store.readData().aiSdkStampReported).toBe(true);
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
  const binding = {
    sequence: Sequence.linear,
    harness: Harness.anthropic,
    model: 'claude-test',
  };

  store.setAuthenticated({ credentials, apiProject: null, apiUser: null });
  store.setBinding(binding);
  const written = store.readData();
  credentials.accessToken = 'changed input';
  binding.model = 'changed input';
  observed[1].data.binding!.model = 'changed by observer';
  store.readData().credentials!.accessToken = 'changed output';

  expect(observed).toHaveLength(2);
  expect(observed[0].data.binding).toBeNull();
  expect(store.readData()).toEqual(written);
  expect(written).toMatchObject({
    credentials: { accessToken: 'test-access-token' },
    binding: { model: 'claude-test' },
  });
});
