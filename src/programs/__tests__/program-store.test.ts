import { RunOutcome } from '@agent';
import { OutroKind } from '@agent/progress';
import type { RunResult } from '@agent/types';
import type { ApiProject, ApiUser, Credentials } from '@shared/api';
import { Harness, Integration, Sequence } from '@shared/constants';
import { ErrorCodes } from '@shared/errors';
import {
  ProgramStore,
  type ProgramDataProgress,
  type ProgramProgress,
} from '../program-store';

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
    failure: { code: ErrorCodes.AgentAbort, message: 'Cancelled by user' },
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
    failure: {
      code: ErrorCodes.InternalUnhandled,
      message: error.message,
      error,
    },
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

it.each(['metadata', 'cause'] as const)(
  'preserves a crash error with non-cloneable %s',
  (field) => {
    class GatewayFailure extends Error {
      config = { transformRequest: () => 'body' };
    }
    const store = new ProgramStore();
    const error = new GatewayFailure('Connection failed');
    if (field === 'cause') {
      error.cause = () => 'retry';
    }
    const result: RunResult = {
      outcome: RunOutcome.Crashed,
      failure: {
        code: ErrorCodes.InternalUnhandled,
        message: error.message,
        error,
      },
      snapshot: {
        tasks: [],
        statusMessages: ['original'],
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
      },
    };

    expect(() => store.beginRun({ runId: field }).finish(result)).not.toThrow();
    result.snapshot.statusMessages.push('changed input');
    for (const stored of [store.results()[0], store.settledRuns()[0].result]) {
      expect(stored.outcome).toBe(RunOutcome.Crashed);
      if (stored.outcome !== RunOutcome.Crashed) continue;
      expect(stored.failure.error).toBe(error);
      expect(stored.failure.error).toBeInstanceOf(GatewayFailure);
      expect(stored.failure.error?.message).toBe('Connection failed');
      expect(stored.snapshot.statusMessages).toEqual(['original']);
    }
  },
);

it('owns authentication, detection, and composition data independently of progress', () => {
  const store = new ProgramStore();
  expect(store.readData()).toEqual({
    credentials: null,
    apiProject: null,
    apiUser: null,
    detection: {
      integration: null,
      typescript: false,
      detectedFrameworkLabel: null,
      complete: false,
      frameworkContext: {},
    },
    composition: { parentProgramId: null, completedRuns: [] },
    eventPlan: [],
    binding: null,
  });

  const credentials = {
    accessToken: 'test-access-token',
    projectApiKey: 'test-project-key',
    projectId: 42,
    host: { region: 'us', apiHost: 'https://example.test' },
  } as Credentials;
  const apiProject = {
    id: 42,
    name: 'Example project',
  } as ApiProject;
  const apiUser = { distinct_id: 'test-user' } as ApiUser;
  const frameworkValue = { paths: ['apps/web'] };
  const completedRuns = ['integrate-run'];

  store.setAuthenticated({ credentials, apiProject, apiUser });
  store.setDetection({
    integration: Integration.nextjs,
    typescript: true,
    detectedFrameworkLabel: 'Next.js app',
    complete: true,
  });
  store.setDetection({ detectedFrameworkLabel: undefined });
  store.setFrameworkContext('selectedProject', frameworkValue);
  const eventPlan = [{ name: 'signup', description: 'Account created' }];
  store.setEventPlan(eventPlan);
  store.setComposition({ parentProgramId: 'self-driving', completedRuns });
  store.markProgramCompleted('follow-up');
  store.markProgramCompleted('follow-up');
  const binding = {
    sequence: Sequence.linear,
    harness: Harness.anthropic,
    model: 'claude-test',
  };
  store.setBinding(binding);

  credentials.accessToken = 'changed input';
  apiProject.name = 'Changed input';
  apiUser.distinct_id = 'changed input';
  frameworkValue.paths.push('changed input');
  eventPlan[0].name = 'changed input';
  completedRuns.push('changed input');
  binding.model = 'changed input';

  expect(store.readData()).toMatchObject({
    credentials: { accessToken: 'test-access-token' },
    apiProject: { name: 'Example project' },
    apiUser: { distinct_id: 'test-user' },
    detection: {
      integration: Integration.nextjs,
      typescript: true,
      detectedFrameworkLabel: 'Next.js app',
      complete: true,
      frameworkContext: { selectedProject: { paths: ['apps/web'] } },
    },
    composition: {
      parentProgramId: 'self-driving',
      completedRuns: ['integrate-run', 'follow-up'],
    },
    eventPlan: [{ name: 'signup', description: 'Account created' }],
    binding: { sequence: Sequence.linear, model: 'claude-test' },
  });

  const copy = store.readData();
  if (!copy.credentials) throw new Error('Expected credentials');
  copy.credentials.accessToken = 'changed output';
  (
    copy.detection.frameworkContext.selectedProject as { paths: string[] }
  ).paths.push('changed output');
  copy.composition.completedRuns.push('changed output');
  copy.eventPlan[0].name = 'changed output';
  expect(store.readData().credentials?.accessToken).toBe('test-access-token');
  expect(store.readData().detection.frameworkContext.selectedProject).toEqual({
    paths: ['apps/web'],
  });
  expect(store.readData().composition.completedRuns).toEqual([
    'integrate-run',
    'follow-up',
  ]);
  expect(store.readData().eventPlan).toEqual([
    { name: 'signup', description: 'Account created' },
  ]);
  store.setAuthenticated({
    credentials: { ...credentials, accessToken: 'refreshed-test-token' },
    apiProject,
    apiUser,
  });
  expect(store.readData().credentials?.accessToken).toBe(
    'refreshed-test-token',
  );
  expect(store.read()).toEqual({ runs: [], diagnostics: [] });
});

it('copies invocation data supplied when the store is created', () => {
  const frameworkContext = { selectedProject: { paths: ['apps/web'] } };
  const completedRuns = ['integrate-run'];
  const store = new ProgramStore({
    detection: { frameworkContext, integration: Integration.nextjs },
    composition: { completedRuns },
  });

  frameworkContext.selectedProject.paths.push('changed input');
  completedRuns.push('changed input');
  expect(store.readData().detection.frameworkContext).toEqual({
    selectedProject: { paths: ['apps/web'] },
  });
  expect(store.readData().composition.completedRuns).toEqual(['integrate-run']);
});

it('records only settled agent results in finish order, separate from progress', () => {
  const store = new ProgramStore();
  const first = store.beginRun({ runId: 'first', stepId: 'integrate' });
  const second = store.beginRun({ runId: 'second' });
  first.onProgress({
    kind: 'completion',
    outro: { kind: OutroKind.Success, message: 'Projected completion' },
  });

  expect(store.read().runs[0]).toMatchObject({
    runId: 'first',
    phase: 'pending',
    outro: { message: 'Projected completion' },
  });
  expect(store.settledRuns()).toEqual([]);

  const secondResult = success({
    tasks: [],
    statusMessages: ['Second finished'],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    },
  });
  const firstResult = success({
    tasks: [],
    statusMessages: ['First finished'],
    usage: {
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    },
  });
  second.finish(secondResult);
  first.finish(firstResult);

  expect(store.settledRuns()).toEqual([
    { runId: 'second', stepId: undefined, result: secondResult },
    { runId: 'first', stepId: 'integrate', result: firstResult },
  ]);
  expect(store.results()).toEqual([firstResult, secondResult]);

  secondResult.snapshot.statusMessages.push('changed input');
  const ledgerCopy = store.settledRuns();
  ledgerCopy[0].result.snapshot.statusMessages.push('changed output');
  expect(store.settledRuns()[0].result.snapshot.statusMessages).toEqual([
    'Second finished',
  ]);
  expect(() => first.finish(firstResult)).toThrow('already finished');
  expect(store.settledRuns()).toHaveLength(2);
});

it('emits a program-data snapshot after each write, and each snapshot is a copy', () => {
  const observed: ProgramDataProgress[] = [];
  const store = new ProgramStore(
    {},
    { onData: (progress) => observed.push(progress) },
  );
  const credentials = {
    accessToken: 'test-access-token',
    projectApiKey: 'test-project-key',
    projectId: 42,
    host: { region: 'us', apiHost: 'https://example.test' },
  } as Credentials;

  store.setAuthenticated({ credentials, apiProject: null, apiUser: null });
  store.setDetection({ integration: Integration.nextjs, complete: true });
  store.setFrameworkContext('selectedProject', { paths: ['apps/web'] });
  store.setEventPlan([{ name: 'signup', description: 'Account created' }]);
  store.setComposition({ parentProgramId: 'self-driving' });
  store.markProgramCompleted('integrate-run');

  expect(observed.map((progress) => progress.kind)).toEqual([
    'program',
    'program',
    'program',
    'program',
    'program',
    'program',
  ]);
  expect(observed[0].data).toMatchObject({
    credentials: { accessToken: 'test-access-token' },
    detection: { integration: null, complete: false },
  });
  expect(observed[1].data.detection).toMatchObject({
    integration: Integration.nextjs,
    complete: true,
    frameworkContext: {},
  });
  expect(observed[2].data.detection.frameworkContext).toEqual({
    selectedProject: { paths: ['apps/web'] },
  });
  expect(observed[3].data.eventPlan).toEqual([
    { name: 'signup', description: 'Account created' },
  ]);
  expect(observed[4].data.composition).toEqual({
    parentProgramId: 'self-driving',
    completedRuns: [],
  });
  expect(observed[5].data).toEqual(store.readData());

  observed[5].data.eventPlan[0].name = 'changed by observer';
  observed[5].data.composition.completedRuns.push('changed by observer');
  expect(store.readData().eventPlan).toEqual([
    { name: 'signup', description: 'Account created' },
  ]);
  expect(store.readData().composition.completedRuns).toEqual(['integrate-run']);
  expect(observed[3].data.eventPlan[0].name).toBe('signup');
});

it('emits no snapshot for a completion already recorded', () => {
  const onData = vi.fn();
  const store = new ProgramStore(
    { composition: { completedRuns: ['integrate-run'] } },
    { onData },
  );

  store.markProgramCompleted('integrate-run');

  expect(onData).not.toHaveBeenCalled();
});

it('records a throwing or rejecting data observer as a diagnostic and keeps the write', async () => {
  const onData = vi
    .fn()
    .mockImplementationOnce(() => {
      throw new Error('observer threw');
    })
    .mockImplementationOnce(() => Promise.reject(new Error('delivery failed')));
  const store = new ProgramStore({}, { onData });

  store.setDetection({ typescript: true });
  store.markProgramCompleted('integrate-run');

  expect(store.readData()).toMatchObject({
    detection: { typescript: true },
    composition: { completedRuns: ['integrate-run'] },
  });
  await vi.waitFor(() => {
    expect(store.read().diagnostics).toEqual([
      { eventKind: 'data', message: 'observer threw' },
      { eventKind: 'data', message: 'delivery failed' },
    ]);
  });
});

it('records a snapshot that cannot be copied as a diagnostic and does not emit it', () => {
  const onData = vi.fn();
  const store = new ProgramStore({}, { onData });
  const clone = structuredClone;
  vi.stubGlobal(
    'structuredClone',
    vi.fn(clone).mockImplementationOnce(() => {
      throw new DOMException('could not be cloned', 'DataCloneError');
    }),
  );

  try {
    store.markProgramCompleted('integrate-run');
  } finally {
    vi.unstubAllGlobals();
  }

  expect(onData).not.toHaveBeenCalled();
  expect(store.read().diagnostics).toEqual([
    { eventKind: 'data', message: 'could not be cloned' },
  ]);
  expect(store.readData().composition.completedRuns).toEqual(['integrate-run']);
});
