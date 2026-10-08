import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  buildSession,
  createSkillProgram,
  runProgram,
  SessionStore,
} from '@programs';
import type { ProgramRun } from '@programs/types';
import type {
  AgentProgress,
  RunInput,
  ProgramCompletionContext,
} from '@agent/types';
import { HostResolution } from '@shared/host-resolution';
import {
  Harness,
  Integration,
  Sequence,
  SONNET_5_MODEL,
} from '@shared/constants';
import { config as integration } from '@programs/posthog-integration';
import { FRAMEWORK_REGISTRY } from '../frameworks/registry';
import { analytics } from '@utils/analytics';
import { requestDeepLink } from '@utils/provisioning';
import { openTrackedLink } from '@utils/links';
import { OutroKind } from '@shared/outro';
import { RunOutcome, RunPhase } from '@shared/run-state';

const harness = vi.hoisted(() => ({ run: vi.fn(), runTask: vi.fn() }));
vi.mock('@agent/runner/harness/pi', () => ({
  piBackend: { name: 'pi', ...harness },
}));
vi.mock('@agent/gateway-session', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  gatewayAuth: () =>
    Promise.resolve({
      gatewayUrl: 'https://example.com',
      token: 'fake',
      refreshAtMs: Infinity,
    }),
}));
vi.mock('@utils/analytics');
vi.mock('@utils/debug');
vi.mock('@utils/provisioning', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  requestDeepLink: vi.fn(() => Promise.resolve('https://example.com/continue')),
}));
vi.mock('@utils/links', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  openTrackedLink: vi.fn(),
}));
vi.mock('@shared/skill-install', () => ({
  installSkillById: () => Promise.resolve({ kind: 'ok', path: '/fake-skill' }),
}));
vi.mock('@shared/skill-menu', () => ({
  fetchSkillMenu: () => Promise.resolve({ categories: {} }),
}));
vi.mock('@agent/agent-prompt-loader', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  loadAgentRegistry: () =>
    Promise.resolve({
      seed: {
        body: 'Plan work',
        skills: [],
        allowedTools: [],
        disallowedTools: [],
      },
      types: ['install', 'review'],
      enqueueableTypes: ['install', 'review'],
      excludedTypes: [],
      runnerSeededTypes: [],
      optionalTypes: [],
      sinkTypes: [],
      get: () => ({
        body: 'Complete work',
        skills: [],
        allowedTools: [],
        disallowedTools: [],
        dependsOn: [],
      }),
    }),
}));

const credentials = {
  posthog: {
    accessToken: 'fake-access-token',
    projectApiKey: 'fake-project-key',
    projectId: 42,
    host: HostResolution.fromRegion('us'),
  },
  project: null,
  apiUser: null,
};
const report = 'Setup report for the example project.\n';
const notebookUrl = 'https://example.com/notebook';
let directory: string;
const run: ProgramRun = {
  integrationLabel: 'example',
  skillId: 'example-skill',
  spinnerMessage: 'Running',
  successMessage: 'Setup complete',
  estimatedDurationMinutes: 1,
  reportFile: 'setup-report.md',
  docsUrl: 'https://example.com/docs',
};
const store = (): SessionStore => {
  const result = new SessionStore(buildSession({ installDir: directory }));
  result.update({ signup: true });
  return result;
};
type HarnessInput = {
  input: RunInput;
  config: { run: { reportFile: string } };
  emit: (event: AgentProgress) => void;
};
type TaskInput = HarnessInput & {
  analyticsProperties: { task_type: string };
  orchestrator: {
    currentTaskId?: string;
    store: {
      enqueue: (task: {
        type: string;
        dependsOn?: string[];
        optional?: boolean;
      }) => { id: string };
      complete: (
        id: string,
        handoff?: {
          goals: string;
          did: string;
          forNextAgent: string;
          conflict?: string;
        },
      ) => void;
    };
  };
};
function publish({ input, config, emit }: HarnessInput): void {
  fs.writeFileSync(path.join(input.installDir, config.run.reportFile), report);
  emit({ kind: 'url', which: 'notebook', url: notebookUrl });
  emit({ kind: 'handoff', text: report });
}

function requiredTaskId(id: string | undefined): string {
  if (!id) throw new Error('Expected a running task');
  return id;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(analytics.getAllFlagsForWizard).mockResolvedValue({});
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'program-completion-'));
  harness.run.mockImplementation((input: HarnessInput) => {
    publish(input);
    return Promise.resolve({ kind: 'success' });
  });
  harness.runTask.mockImplementation((input: TaskInput) => {
    const { store, currentTaskId } = input.orchestrator;
    if (input.analyticsProperties.task_type === 'seed') {
      const task = store.enqueue({ type: 'install' });
      store.enqueue({ type: 'review', dependsOn: [task.id] });
    } else {
      store.complete(requiredTaskId(currentTaskId), {
        goals: 'Complete setup',
        did: 'Completed setup',
        forNextAgent: 'Continue',
        conflict:
          input.analyticsProperties.task_type === 'review'
            ? 'Review the example build'
            : undefined,
      });
      if (input.analyticsProperties.task_type === 'review') publish(input);
    }
    return Promise.resolve({ kind: 'success' });
  });
});

it('awaits preparation after orchestrated drain without invoking linear effects', async () => {
  const session = store();
  const events: AgentProgress[] = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const prepareOutro = vi.fn(async () => {
    await pending;
  });
  const postRun = vi.fn(() => Promise.resolve());
  const buildOutroData = vi.fn();
  const result = runProgram(
    'example',
    {
      store: session,
      credentials,
      invocation: 'interactive',
      wizardFlags: {},
      config: {
        healthCheck: false,
        binding: {
          harness: Harness.pi,
          sequence: Sequence.orchestrator,
          model: SONNET_5_MODEL,
        },
        run: {
          ...run,
          prepareOutro,
          postRun,
          buildOutroData,
          buildOutroNextSteps: () => ({ heading: 'Next', items: ['Continue'] }),
        },
      },
    },
    { onProgress: ({ event }) => events.push(event) },
  );
  await vi.waitFor(() => expect(prepareOutro).toHaveBeenCalledTimes(1));
  expect(events.some((event) => event.kind === 'completion')).toBe(false);
  expect(fs.readFileSync(path.join(directory, run.reportFile), 'utf8')).toBe(
    report,
  );
  release();
  expect((await result).outcome).toBe(RunOutcome.Success);
  expect(postRun).not.toHaveBeenCalled();
  expect(buildOutroData).not.toHaveBeenCalled();
  expect(session.session.outroData).toMatchObject({
    message: 'PostHog set up, with one conflict to review.',
    body: expect.stringContaining('Review the example build'),
    nextSteps: { items: ['Continue'] },
  });
  expect(session.session.notebookUrl).toBe(notebookUrl);
  expect(events.filter((event) => event.kind === 'handoff')).toHaveLength(1);
});
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

it('prepares the actual constructed standalone instrumentation config with its resolved identity', async () => {
  let context: ProgramCompletionContext | undefined;
  const skillId = 'omnibus-instrument-product-analytics';
  const config = createSkillProgram({
    skillId,
    command: 'skill',
    id: 'agent-skill',
    description: `Run skill: ${skillId}`,
    integrationLabel: skillId,
    successMessage: `${skillId} completed!`,
    reportFile: `posthog-${skillId}-report.md`,
    docsUrl: 'https://posthog.com/docs',
    spinnerMessage: `Running ${skillId}...`,
    estimatedDurationMinutes: 5,
    prepareOutro: (_session, _credentials, completion) => {
      context = completion;

      return Promise.resolve();
    },
  });
  const outcome = await runProgram(config.id, {
    store: store(),
    config,
    credentials,
    invocation: 'interactive',
    wizardFlags: {},
  });
  expect(outcome.outcome).toBe(RunOutcome.Success);
  expect(context).toMatchObject({
    programId: 'agent-skill',
    skillId,
    invocation: 'interactive',
    sequence: Sequence.linear,
    composed: false,
    structured: false,
    taskOutcomes: { kind: 'unavailable', reason: 'linear' },
  });
  expect(context?.signal.aborted).toBe(true);
});

it('awaits program preparation before the linear success outro without republishing the report', async () => {
  const session = store();
  const events: AgentProgress[] = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const order: string[] = [];
  const prepareOutro = vi.fn(async () => {
    order.push('prepare');
    await pending;
    order.push('prepared');
  });
  const result = runProgram(
    'example',
    {
      store: session,
      credentials,
      invocation: 'interactive',
      wizardFlags: {},
      config: {
        healthCheck: false,
        binding: {
          harness: Harness.pi,
          sequence: Sequence.linear,
          model: SONNET_5_MODEL,
        },
        run: {
          ...run,
          postRun: () => {
            order.push('postRun');
            return Promise.resolve();
          },
          prepareOutro,
          buildOutroData: () => {
            order.push('outro');
            return {
              kind: OutroKind.Success,
              message: 'Setup complete',
              reportFile: run.reportFile,
              notebookUrl,
              continueUrl: 'https://example.com/continue',
              nextSteps: { heading: 'Next', items: ['Continue'] },
            };
          },
        },
      },
    },
    { onProgress: ({ event }) => events.push(event) },
  );
  await vi.waitFor(() => expect(prepareOutro).toHaveBeenCalledTimes(1));
  expect(events.some((event) => event.kind === 'completion')).toBe(false);
  expect(order).toEqual(['postRun', 'prepare']);
  expect(fs.readFileSync(path.join(directory, run.reportFile), 'utf8')).toBe(
    report,
  );
  release();
  expect((await result).outcome).toBe(RunOutcome.Success);
  expect(order).toEqual(['postRun', 'prepare', 'prepared', 'outro']);
  expect(session.session.runPhase).toBe(RunPhase.Completed);
  expect(session.session.outroData).toMatchObject({
    notebookUrl,
    continueUrl: 'https://example.com/continue',
    nextSteps: { items: ['Continue'] },
  });
  expect(events.filter((event) => event.kind === 'handoff')).toHaveLength(1);
});

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
} {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function launch(
  sequence: Sequence,
  prepareOutro?: ProgramRun['prepareOutro'],
  options: {
    signal?: AbortSignal;
    invocation?: 'interactive' | 'noninteractive' | 'unknown';
    composed?: boolean;
    ci?: boolean;
    run?: Partial<ProgramRun>;
  } = {},
): {
  session: SessionStore;
  events: AgentProgress[];
  result: ReturnType<typeof runProgram>;
} {
  const session = store();
  if (options.ci) session.update({ ci: true });
  const events: AgentProgress[] = [];
  const result = runProgram(
    'example',
    {
      store: session,
      credentials,
      invocation: options.invocation ?? 'interactive',
      composed: options.composed,
      wizardFlags: {},
      config: {
        healthCheck: false,
        binding: { harness: Harness.pi, sequence, model: SONNET_5_MODEL },
        run: { ...run, prepareOutro, ...options.run },
      },
    },
    { signal: options.signal, onProgress: ({ event }) => events.push(event) },
  );
  return { session, events, result };
}

it.each([Sequence.linear, Sequence.orchestrator])(
  '%s links preparation to host cancellation and discards late work',
  async (sequence) => {
    const host = new AbortController();
    const started = deferred();
    const pending = deferred();
    let signal!: AbortSignal;
    let effects = 0;
    const prepare = vi.fn(
      async (_session, _credentials, context: ProgramCompletionContext) => {
        signal = context.signal;
        started.resolve();
        await pending.promise;
        if (!signal.aborted) effects++;
      },
    );
    const { result, events, session } = launch(sequence, prepare, {
      signal: host.signal,
    });
    await started.promise;
    expect(signal.aborted).toBe(false);
    host.abort('Host cancelled');
    expect((await result).outcome).toBe(RunOutcome.Aborted);
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe('Host cancelled');
    expect(
      events.some(
        (event) =>
          event.kind === 'completion' ||
          (event.kind === 'lifecycle' && event.phase === 'completed'),
      ),
    ).toBe(false);
    expect(session.session.outroData?.kind).toBe(OutroKind.Cancel);
    pending.resolve();
    await Promise.resolve();
    expect(effects).toBe(0);
    expect(prepare).toHaveBeenCalledTimes(1);
  },
);

it.each([Sequence.linear, Sequence.orchestrator])(
  '%s handles a late rejection after host cancellation',
  async (sequence) => {
    const host = new AbortController();
    const started = deferred();
    const pending = deferred();
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const { result, events } = launch(
        sequence,
        async () => {
          started.resolve();
          await pending.promise;
        },
        { signal: host.signal },
      );
      await started.promise;
      host.abort();
      expect((await result).outcome).toBe(RunOutcome.Aborted);
      pending.reject(new Error('Late callback failure'));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
      expect(events.some((event) => event.kind === 'completion')).toBe(false);
    } finally {
      process.removeListener('unhandledRejection', unhandled);
    }
  },
);

it.each([Sequence.linear, Sequence.orchestrator])(
  '%s preserves primary success when preparation rejects',
  async (sequence) => {
    let signal!: AbortSignal;
    const { result, events } = launch(
      sequence,
      (_session, _credentials, context) => {
        signal = context.signal;
        return Promise.reject(new Error('Optional callback failed'));
      },
    );
    expect((await result).outcome).toBe(RunOutcome.Success);
    expect(signal.aborted).toBe(true);
    expect(events.filter((event) => event.kind === 'completion')).toHaveLength(
      1,
    );
    expect(
      events.filter(
        (event) => event.kind === 'lifecycle' && event.phase === 'completed',
      ),
    ).toHaveLength(1);
    expect(fs.readFileSync(path.join(directory, run.reportFile), 'utf8')).toBe(
      report,
    );
  },
);

it.each([Sequence.linear, Sequence.orchestrator])(
  '%s ends optional preparation at four seconds and prevents late effects',
  async (sequence) => {
    vi.useFakeTimers();
    const started = deferred();
    const pending = deferred();
    let signal!: AbortSignal;
    let effects = 0;
    try {
      const { result, events } = launch(
        sequence,
        async (_session, _credentials, context) => {
          signal = context.signal;
          started.resolve();
          await pending.promise;
          if (!signal.aborted) effects++;
        },
      );
      await started.promise;
      await vi.advanceTimersByTimeAsync(3999);
      expect(events.some((event) => event.kind === 'completion')).toBe(false);
      expect(signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect((await result).outcome).toBe(RunOutcome.Success);
      expect(signal.aborted).toBe(true);
      pending.resolve();
      await Promise.resolve();
      expect(effects).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  },
);

it.each([Sequence.linear, Sequence.orchestrator])(
  '%s retires preparation after the synchronous outro decision',
  async (sequence) => {
    let signal!: AbortSignal;
    const checked: boolean[] = [];
    const prepareOutro: ProgramRun['prepareOutro'] = (
      _session,
      _credentials,
      context,
    ) => {
      signal = context.signal;

      return Promise.resolve();
    };
    const { result } = launch(sequence, prepareOutro, {
      run: {
        buildOutroData: () => {
          checked.push(signal.aborted);
          return { kind: OutroKind.Success, message: 'Complete' };
        },
        buildOutroNextSteps: () => {
          checked.push(signal.aborted);
          return { heading: 'Next', items: ['Continue'] };
        },
      },
    });
    expect((await result).outcome).toBe(RunOutcome.Success);
    expect(checked).toEqual([false]);
    expect(signal.aborted).toBe(true);
  },
);

it.each([Sequence.linear, Sequence.orchestrator])(
  '%s leaves excluded invocations and no-hook results unchanged',
  async (sequence) => {
    for (const options of [
      { invocation: 'noninteractive' as const },
      { invocation: 'unknown' as const },
      { ci: true },
      { composed: true },
      { run: { structured: { schema: { type: 'object' }, timeoutMs: 1000 } } },
    ]) {
      const prepare = vi.fn(() => Promise.resolve());
      const { result } = launch(sequence, prepare, options);
      expect((await result).outcome).toBe(RunOutcome.Success);
      expect(prepare).not.toHaveBeenCalled();
    }
    expect((await launch(sequence).result).outcome).toBe(RunOutcome.Success);
  },
);

it.each([Sequence.linear, Sequence.orchestrator])(
  '%s omits preparation when the host cancels before it starts',
  async (sequence) => {
    const host = new AbortController();
    const prepare = vi.fn(() => Promise.resolve());
    const postRun = vi.fn(() => {
      host.abort();
      return Promise.resolve();
    });
    if (sequence === Sequence.orchestrator) {
      harness.runTask.mockImplementationOnce(() => {
        host.abort();
        return Promise.resolve({ kind: 'success' });
      });
    }
    const { result, events } = launch(sequence, prepare, {
      signal: host.signal,
      run: { postRun },
    });
    expect((await result).outcome).toBe(RunOutcome.Aborted);
    expect(prepare).not.toHaveBeenCalled();
    expect(events.some((event) => event.kind === 'completion')).toBe(false);
  },
);

it('preserves a linear postRun error instead of treating it as optional', async () => {
  const error = new Error('Primary postRun failed');
  const prepare = vi.fn(() => Promise.resolve());
  const postRun = vi.fn(() => Promise.reject(error));
  const { result, events } = launch(Sequence.linear, prepare, {
    run: { postRun },
  });
  const outcome = await result;
  expect(outcome.outcome).toBe(RunOutcome.Crashed);
  expect(outcome.failure?.error).toBe(error);
  expect(postRun).toHaveBeenCalledTimes(1);
  expect(prepare).not.toHaveBeenCalled();
  expect(events.some((event) => event.kind === 'completion')).toBe(false);
});

it('defaults an embedder with no invocation classification to unknown', async () => {
  const prepare = vi.fn(() => Promise.resolve());
  const outcome = await runProgram('example', {
    store: store(),
    credentials,
    wizardFlags: {},
    config: { healthCheck: false, run: { ...run, prepareOutro: prepare } },
  });
  expect(outcome.outcome).toBe(RunOutcome.Success);
  expect(prepare).not.toHaveBeenCalled();
});

it.each([
  {
    kind: 'decided_failure',
    failure: { code: 'PHW_AGENT_ABORT', message: 'Stopped' },
  },
  { kind: 'abort', classification: 'WIZARD_ABORT', message: 'Stopped' },
  { kind: 'failure', classification: 'WIZARD_NO_PROGRESS' },
  { kind: 'failure', classification: 'WIZARD_INCOMPLETE_TASKS' },
  { kind: 'failure', classification: 'WIZARD_API_ERROR' },
])(
  'does not prepare a linear $kind/$classification failure',
  async (failure) => {
    harness.run.mockResolvedValueOnce(failure);
    const prepare = vi.fn(() => Promise.resolve());
    const postRun = vi.fn(() => Promise.resolve());
    const { result, events } = launch(Sequence.linear, prepare, {
      run: { postRun },
    });
    expect((await result).outcome).toBe(RunOutcome.Failed);
    expect(prepare).not.toHaveBeenCalled();
    expect(postRun).not.toHaveBeenCalled();
    expect(events.some((event) => event.kind === 'completion')).toBe(false);
  },
);

it.each(['required-failed', 'blocked', 'hollow', 'fatal'] as const)(
  'does not prepare an orchestrated %s run',
  async (failure) => {
    harness.runTask.mockImplementation((input: TaskInput) => {
      if (input.analyticsProperties.task_type === 'seed') {
        if (failure === 'required-failed' || failure === 'fatal')
          input.orchestrator.store.enqueue({ type: 'install' });
        if (failure === 'blocked')
          input.orchestrator.store.enqueue({
            type: 'review',
            dependsOn: ['missing-task'],
          });
        return Promise.resolve({ kind: 'success' });
      }
      if (failure === 'fatal')
        return Promise.resolve({
          kind: 'decided_failure',
          failure: { code: 'PHW_AGENT_ABORT', message: 'Task stopped' },
        });
      return Promise.resolve({ kind: 'success' });
    });
    const prepare = vi.fn(() => Promise.resolve());
    const { result, events } = launch(Sequence.orchestrator, prepare);
    expect((await result).outcome).toBe(RunOutcome.Failed);
    expect(prepare).not.toHaveBeenCalled();
    expect(events.some((event) => event.kind === 'completion')).toBe(false);
  },
);

it('exposes only immutable drained outcome facts without reopening the removed cache', async () => {
  let context!: ProgramCompletionContext;
  const { result } = launch(
    Sequence.orchestrator,
    (_session, _credentials, completion) => {
      context = completion;
      expect(fs.existsSync(path.join(directory, '.posthog-wizard-cache'))).toBe(
        false,
      );

      return Promise.resolve();
    },
  );
  expect((await result).outcome).toBe(RunOutcome.Success);
  expect(context.taskOutcomes).toEqual({
    kind: 'available',
    outcomes: [
      { type: 'install', status: 'done', optional: false },
      { type: 'review', status: 'done', optional: false },
    ],
  });
  expect(Object.isFrozen(context)).toBe(true);
  expect(Object.isFrozen(context.taskOutcomes)).toBe(true);
  if (context.taskOutcomes.kind !== 'available')
    throw new Error('Expected drained outcomes');
  expect(Object.isFrozen(context.taskOutcomes.outcomes)).toBe(true);
  expect(
    context.taskOutcomes.outcomes.every((outcome) => Object.isFrozen(outcome)),
  ).toBe(true);
});

it.each([
  { count: 64, taskType: 'x'.repeat(128), expected: 'available' },
  { count: 65, taskType: 'install', expected: 'limit' },
  { count: 1, taskType: 'x'.repeat(129), expected: 'limit' },
  { count: 1, taskType: '', expected: 'invalid' },
])(
  'marks bounded task facts explicitly for $count tasks of $expected validity',
  async ({ count, taskType, expected }) => {
    harness.runTask.mockImplementation((input: TaskInput) => {
      const { store, currentTaskId } = input.orchestrator;
      if (input.analyticsProperties.task_type === 'seed') {
        for (let i = 0; i < count; i++) store.enqueue({ type: taskType });
      } else store.complete(requiredTaskId(currentTaskId));
      return Promise.resolve({ kind: 'success' });
    });
    let context!: ProgramCompletionContext;
    const { result } = launch(
      Sequence.orchestrator,
      (_session, _credentials, completion) => {
        context = completion;

        return Promise.resolve();
      },
    );
    expect((await result).outcome).toBe(RunOutcome.Success);
    if (expected === 'available') {
      expect(context.taskOutcomes.kind).toBe('available');
      if (context.taskOutcomes.kind !== 'available')
        throw new Error('Expected available outcomes');
      expect(context.taskOutcomes.outcomes).toHaveLength(64);
      expect(context.taskOutcomes.outcomes[0].type).toHaveLength(128);
    } else
      expect(context.taskOutcomes).toEqual({
        kind: 'unavailable',
        reason: expected,
      });
  },
);

it.each([Sequence.linear, Sequence.orchestrator])(
  'prepares the bare SDK program through its actual %s run recipe',
  async (sequence) => {
    const session = store();
    session.update({
      detectionComplete: true,
      integration: Integration.javascriptNode,
      frameworkConfig: FRAMEWORK_REGISTRY[Integration.javascriptNode],
    });
    if (typeof integration.run !== 'function')
      throw new Error('Expected SDK run recipe');
    const recipe = integration.run;
    const prepare = vi.fn(
      (_session, _credentials, context: ProgramCompletionContext) => {
        expect(context).toMatchObject({
          programId: 'posthog-integration',
          skillId: Integration.javascriptNode,
          sequence,
          invocation: 'interactive',
          composed: false,
          structured: false,
        });
        expect(context.signal.aborted).toBe(false);

        return Promise.resolve();
      },
    );
    const result = await runProgram(integration.id, {
      store: session,
      credentials,
      invocation: 'interactive',
      wizardFlags: {},
      config: {
        ...integration,
        healthCheck: false,
        binding: { harness: Harness.pi, sequence, model: SONNET_5_MODEL },
        run: async (current, runner) => ({
          ...(await recipe(current, runner)),
          prepareOutro: prepare,
        }),
      },
    });
    expect(result.outcome).toBe(RunOutcome.Success);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(session.session.notebookUrl).toBe(notebookUrl);
    if (sequence === Sequence.linear) {
      expect(requestDeepLink).toHaveBeenCalledTimes(1);
      expect(openTrackedLink).toHaveBeenCalledTimes(1);
      expect(session.session.outroData).toMatchObject({
        kind: OutroKind.Success,
        message: 'Successfully installed PostHog!',
        notebookUrl,
        continueUrl: expect.stringContaining('https://example.com/continue'),
        handoffPrompt: expect.stringContaining(notebookUrl),
      });
    } else {
      expect(requestDeepLink).not.toHaveBeenCalled();
      expect(openTrackedLink).not.toHaveBeenCalled();
      expect(session.session.outroData?.message).toBe(
        'PostHog set up, with one conflict to review.',
      );
    }
  },
);

it.each([Sequence.linear, Sequence.orchestrator])(
  '%s retains a committed callback effect when the host then cancels',
  async (sequence) => {
    const host = new AbortController();
    let effects = 0;
    const { result, events } = launch(
      sequence,
      (_session, _credentials, context) => {
        if (!context.signal.aborted) effects++;
        host.abort();

        return Promise.resolve();
      },
      { signal: host.signal },
    );
    expect((await result).outcome).toBe(RunOutcome.Aborted);
    expect(effects).toBe(1);
    expect(events.some((event) => event.kind === 'completion')).toBe(false);
  },
);

it('preserves optional failures and skipped work in successful drained facts', async () => {
  type OptionalTaskInput = TaskInput & {
    orchestrator: {
      store: {
        fail: (id: string, error: { type: string; message: string }) => void;
        skip: (id: string) => void;
      };
    };
  };
  harness.runTask.mockImplementation((input: OptionalTaskInput) => {
    const { store, currentTaskId } = input.orchestrator;
    if (input.analyticsProperties.task_type === 'seed') {
      store.enqueue({ type: 'optional', optional: true });
      store.enqueue({ type: 'skipped' });
      store.enqueue({ type: 'install' });
    } else if (input.analyticsProperties.task_type === 'optional') {
      store.fail(requiredTaskId(currentTaskId), {
        type: 'example-error',
        message: 'Example optional failure',
      });
    } else if (input.analyticsProperties.task_type === 'skipped')
      store.skip(requiredTaskId(currentTaskId));
    else store.complete(requiredTaskId(currentTaskId));
    return Promise.resolve({ kind: 'success' });
  });
  let context!: ProgramCompletionContext;
  const { result, session } = launch(
    Sequence.orchestrator,
    (_session, _credentials, completion) => {
      context = completion;

      return Promise.resolve();
    },
  );
  expect((await result).outcome).toBe(RunOutcome.Success);
  expect(context.taskOutcomes).toEqual({
    kind: 'available',
    outcomes: [
      { type: 'optional', status: 'failed', optional: true },
      { type: 'skipped', status: 'not needed', optional: false },
      { type: 'install', status: 'done', optional: false },
    ],
  });
  expect(session.session.outroData?.message).toBe(
    'PostHog set up: 1/1 steps completed (1 skipped as not required, 1 optional step failed).',
  );
});

it.each([Sequence.linear, Sequence.orchestrator])(
  '%s preserves an outro builder error and closes prepared state',
  async (sequence) => {
    const error = new Error('Primary outro builder failed');
    let signal!: AbortSignal;
    const { result, events } = launch(
      sequence,
      (_session, _credentials, context) => {
        signal = context.signal;
        return Promise.resolve();
      },
      {
        run: {
          buildOutroData: () => {
            throw error;
          },
          buildOutroNextSteps: () => {
            throw error;
          },
        },
      },
    );
    const outcome = await result;
    expect(outcome.outcome).toBe(RunOutcome.Crashed);
    expect(outcome.failure?.error).toBe(error);
    expect(signal.aborted).toBe(true);
    expect(events.some((event) => event.kind === 'completion')).toBe(false);
  },
);

it('keeps composed postRun and structured early success behavior', async () => {
  const postRun = vi.fn(() => Promise.resolve());
  const prepare = vi.fn(() => Promise.resolve());
  const composed = launch(Sequence.orchestrator, prepare, {
    composed: true,
    run: { postRun },
  });
  const composedOutcome = await composed.result;
  expect(composedOutcome.outcome).toBe(RunOutcome.Success);
  expect(postRun).toHaveBeenCalledTimes(1);
  expect(prepare).not.toHaveBeenCalled();
  expect(composed.events.some((event) => event.kind === 'completion')).toBe(
    false,
  );
  postRun.mockClear();
  harness.run.mockResolvedValueOnce({
    kind: 'success',
    structuredOutput: { example: true },
  });
  const structured = launch(Sequence.linear, prepare, {
    run: {
      postRun,
      structured: { schema: { type: 'object' }, timeoutMs: 1000 },
    },
  });
  const outcome = await structured.result;
  expect(outcome.outcome).toBe(RunOutcome.Success);
  expect(outcome.runResults[0]).toMatchObject({
    structuredOutput: { example: true },
  });
  expect(postRun).not.toHaveBeenCalled();
  expect(prepare).not.toHaveBeenCalled();
  expect(
    structured.events.some(
      (event) => event.kind === 'completion' || event.kind === 'lifecycle',
    ),
  ).toBe(false);
});
