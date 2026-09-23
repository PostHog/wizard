/**
 * `runAgent(config, input, options)` runs with no UI, no store, no session and
 * no program registry: a fake harness stands in for the SDK, and everything
 * the run reports arrives through `onProgress` or comes back in the result.
 *
 * The `@ui` mock below throws on use. It is never reached — that is the
 * assertion the whole file rests on.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Harness, Sequence, DEFAULT_AGENT_MODEL } from '@shared/constants';
import { HostResolution } from '@shared/host-resolution';
import {
  OutroKind,
  type AskAnswers,
  type PendingQuestion,
} from '@lib/wizard-session';
import { ErrorCodes, WizardError } from '@shared/errors';
import { AGENT_ERROR_CODE } from '@agent/error-map';
import { AgentErrorType } from '@agent/signals';
import { CANCELLED_SENTINEL, type AskResponse } from '@agent/wizard-ask-bridge';
import type { AgentFailure } from '@agent/runner/shared/types';
import type { AgentProgress } from '@agent/progress';
import type {
  AgentResult,
  AgentHarness,
  BackendRunInputs,
  TaskRunInputs,
} from '@agent/runner/harness/types';

vi.mock('@ui', () => ({
  getUI: () => {
    throw new Error('the agent reached for getUI()');
  },
  setUI: () => {
    throw new Error('the agent reached for setUI()');
  },
}));
vi.mock('@utils/debug');
vi.mock('@utils/terminal-bell');
vi.mock('@agent/yara-hooks', async (original) => ({
  ...(await original<typeof import('@agent/yara-hooks')>()),
  flushScanReport: vi.fn(),
}));
vi.mock('@utils/analytics', () => ({
  analytics: {
    build: 'test',
    runId: 'run-1',
    wizardCapture: vi.fn(),
    capture: vi.fn(),
    captureException: vi.fn(),
    setTag: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  },
}));

// The fake harness: reports a little of everything, then returns what the
// current test told it to.
const harnessState = vi.hoisted(() => ({
  result: { kind: 'success' } as AgentResult,
  throws: undefined as Error | undefined,
  lastInputs: undefined as unknown,
  tasks: [] as TaskRunInputs[],
  selected: [] as Harness[],
  taskFailure: undefined as AgentFailure | undefined,
  taskThrow: undefined as Error | undefined,
  seedFailure: undefined as AgentFailure | undefined,
  askQuestions: undefined as PendingQuestion['questions'] | undefined,
  taskCapability: true,
  waitForAbort: false,
  /** How many install tasks the seed plans. */
  seedTasks: 1,
  /** Scripts each drained task in place of the default install. */
  task: undefined as
    | ((inputs: TaskRunInputs) => Promise<AgentResult>)
    | undefined,
  /** Scripts the linear run in place of the default one. */
  run: undefined as
    | ((inputs: BackendRunInputs) => Promise<AgentResult>)
    | undefined,
}));
vi.mock('@agent/runner/switchboard/harness', () => {
  const waitForAbort = async (signal: AbortSignal | undefined) => {
    if (!signal) throw new Error('host signal did not reach active harness');
    if (signal.aborted) return;
    await new Promise<void>((resolve) =>
      signal.addEventListener('abort', () => resolve(), { once: true }),
    );
  };
  const askIfRequested = async (inputs: BackendRunInputs | TaskRunInputs) => {
    if (!harnessState.askQuestions || !inputs.askBridge) return;
    const { answers } = await inputs.askBridge.request({
      questions: harnessState.askQuestions,
    });
    inputs.emit({
      kind: 'status',
      message: `answered:${JSON.stringify(answers)}`,
    });
  };
  const fake: AgentHarness = {
    name: Harness.pi,
    async runTask(inputs: TaskRunInputs) {
      harnessState.tasks.push(inputs);
      const { store, currentTaskId } = inputs.orchestrator;
      if (currentTaskId && harnessState.waitForAbort) {
        await waitForAbort(inputs.signal);
        return {
          kind: 'abort',
          classification: AgentErrorType.ABORT,
          message: 'Agent run cancelled',
        };
      }
      if (!currentTaskId) {
        if (harnessState.seedFailure)
          return { kind: 'decided_failure', failure: harnessState.seedFailure };
        for (let i = 0; i < harnessState.seedTasks; i++)
          store.enqueue({ type: 'install' });
      } else if (harnessState.task) {
        return harnessState.task(inputs);
      } else if (harnessState.taskThrow) {
        throw harnessState.taskThrow;
      } else if (harnessState.taskFailure) {
        return { kind: 'decided_failure', failure: harnessState.taskFailure };
      } else {
        await askIfRequested(inputs);
        store.complete(currentTaskId, {
          goals: 'install',
          did: 'installed',
          forNextAgent: 'done',
        });
      }
      return { kind: 'success' };
    },
    async run(inputs: BackendRunInputs) {
      harnessState.lastInputs = inputs;
      if (harnessState.waitForAbort) {
        await waitForAbort(inputs.signal);
        return {
          kind: 'abort',
          classification: AgentErrorType.ABORT,
          message: 'Agent run cancelled',
        };
      }
      if (harnessState.run) return harnessState.run(inputs);
      const { emit, spinner } = inputs;
      emit({ kind: 'log', level: 'step', message: 'Initializing agent' });
      spinner.start('Working');
      emit({ kind: 'status', message: 'Installing the SDK' });
      emit({
        kind: 'tasks',
        tasks: [{ content: 'Install', status: 'completed' }],
      });
      emit({ kind: 'url', which: 'dashboard', url: 'https://d/1' });
      emit({ kind: 'url', which: 'notebook', url: 'https://n/1' });
      emit({ kind: 'stage', stage: 'Configure' });
      emit({ kind: 'finalCost', usd: 0.25 });
      emit({
        kind: 'usage',
        delta: {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          cacheCreation5m: 0,
          cacheCreation1h: 0,
        },
      });
      await askIfRequested(inputs);
      if (harnessState.throws) throw harnessState.throws;
      spinner.stop('Done');
      return harnessState.result;
    },
  };
  return {
    HARNESS_OPTIONS: { [Harness.pi]: fake },
    getHarness: (name: Harness) => {
      harnessState.selected.push(name);
      return {
        ...fake,
        name,
        runTask: harnessState.taskCapability ? fake.runTask : undefined,
      };
    },
    resolveHarness: (ctx: { cliHarness?: Harness }) => ({
      harness: ctx.cliHarness ?? Harness.pi,
      model: DEFAULT_AGENT_MODEL,
    }),
    resolveRoleHarness: (binding: RunConfig['binding'], role: string) =>
      binding.roleBindings?.[role] ?? {
        harness: binding.harness,
        model: binding.model,
        thinkingLevel: binding.thinkingLevel,
      },
  };
});

vi.mock('@agent/agent-prompt-loader', async (original) => {
  const actual = await original<typeof import('@agent/agent-prompt-loader')>();
  return {
    ...actual,
    loadAgentRegistry: vi.fn(() =>
      Promise.resolve(
        actual.buildRegistry(
          [
            actual.parseAgentPrompt(
              '---\ntype: seed\nseed: true\n---\nPlan work',
              'seed',
              'test-program',
            ),
            actual.parseAgentPrompt(
              '---\ntype: install\nallowedTools: [wizard_ask]\n---\nInstall it',
              'install',
              'test-program',
            ),
          ],
          'test-program',
        ),
      ),
    ),
  };
});
vi.mock('@shared/skill-menu', async (original) => ({
  ...(await original<typeof import('@shared/skill-menu')>()),
  fetchSkillMenu: vi.fn().mockResolvedValue({ categories: {} }),
}));

import { runAgent, RunOutcome } from '@agent/runner';
import type { RunConfig, RunInput } from '@agent/runner';
import { analytics } from '@utils/analytics';
import { initLogFile } from '@utils/debug';
import { flushScanReport } from '@agent/yara-hooks';
import { clearCleanup, runCleanups } from '@utils/cleanup-registry';
import { QUEUE_DIR_NAME } from '../runner/sequence/orchestrator/queue';

let tmp: string;

const config = (over: Partial<RunConfig> = {}): RunConfig => ({
  programId: 'test-program',
  run: {
    integrationLabel: 'test-integration',
    spinnerMessage: 'Working...',
    successMessage: 'Done!',
    estimatedDurationMinutes: 1,
    reportFile: 'report.md',
    docsUrl: 'https://docs.test',
    abortCases: [
      {
        match: /no stripe/i,
        message: 'No Stripe here',
        body: 'Stripe is required.',
        errorCode: ErrorCodes.AgentAbort,
      },
    ],
  },
  composed: false,
  binding: { sequence: Sequence.linear, harness: Harness.pi, model: 'm' },
  skillsBaseUrl: 'https://skills.test',
  wizardFlags: {},
  wizardFlagPayloads: {},
  wizardMetadata: {},
  ...over,
});

const input = (over: Partial<RunInput> = {}): RunInput => ({
  installDir: tmp,
  credentials: {
    accessToken: 'tok',
    projectApiKey: 'phc_test',
    host: HostResolution.fromApiHost('https://us.posthog.com'),
    projectId: 1,
  },
  inferenceAuth: {
    resolve: () =>
      Promise.resolve({
        gatewayUrl: 'https://gateway.test',
        token: 'phe_run',
        teamId: 1,
        refreshAtMs: Date.now() + 3_600_000,
      }),
  },
  project: null,
  apiUser: null,
  skillId: 'test-integration',
  flags: {
    ci: false,
    signup: false,
    debug: false,
    e2eAsk: false,
    localMcp: false,
    captureAio: false,
    benchmark: false,
    yaraReport: false,
  },
  host: {},
  ...over,
});

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-agent-standalone-'));
  harnessState.result = { kind: 'success' };
  harnessState.tasks = [];
  harnessState.selected = [];
  harnessState.taskFailure = undefined;
  harnessState.taskThrow = undefined;
  harnessState.seedFailure = undefined;
  harnessState.throws = undefined;
  harnessState.lastInputs = undefined;
  harnessState.askQuestions = undefined;
  harnessState.taskCapability = true;
  harnessState.waitForAbort = false;
  harnessState.seedTasks = 1;
  harnessState.task = undefined;
  harnessState.run = undefined;
  vi.mocked(analytics.shutdown).mockClear();
  vi.mocked(analytics.wizardCapture).mockClear();
  vi.mocked(initLogFile).mockClear();
  vi.mocked(flushScanReport).mockClear();
});

afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('runAgent standalone', () => {
  it.each([Sequence.linear, Sequence.orchestrator])(
    'returns a typed abort before bootstrapping %s',
    async (sequence) => {
      const controller = new AbortController();
      controller.abort();
      const result = await runAgent(
        config({
          binding: {
            harness: Harness.pi,
            sequence,
            model: DEFAULT_AGENT_MODEL,
          },
        }),
        input(),
        { signal: controller.signal },
      );

      expect(result.outcome).toBe(RunOutcome.Aborted);
      expect(result.failure?.code).toBe(ErrorCodes.AgentAbort);
      expect(harnessState.selected).toEqual([]);
      expect(harnessState.tasks).toEqual([]);
      expect(flushScanReport).toHaveBeenCalledTimes(1);
    },
  );

  it.each([Sequence.linear, Sequence.orchestrator])(
    'aborts an active %s harness before outro and cleans the queue',
    async (sequence) => {
      harnessState.waitForAbort = true;
      const skillRoot = path.join(tmp, '.claude', 'skills');
      const preexistingSkill = path.join(skillRoot, 'preexisting');
      fs.mkdirSync(preexistingSkill, { recursive: true });
      fs.writeFileSync(path.join(preexistingSkill, '.posthog-wizard'), '');
      const controller = new AbortController();
      const postRun = vi.fn();
      const events: AgentProgress[] = [];
      const running = runAgent(
        config({
          binding: {
            harness: Harness.pi,
            sequence,
            model: DEFAULT_AGENT_MODEL,
          },
          hooks: { postRun },
        }),
        input(),
        {
          signal: controller.signal,
          onProgress: (event) => events.push(event),
        },
      );

      await vi.waitFor(() =>
        expect(
          sequence === Sequence.linear
            ? harnessState.lastInputs
            : harnessState.tasks.some(
                (task) => task.orchestrator.currentTaskId,
              ),
        ).toBeTruthy(),
      );
      const runSkill = path.join(skillRoot, 'installed-during-run');
      fs.mkdirSync(runSkill);
      fs.writeFileSync(path.join(runSkill, '.posthog-wizard'), '');
      const userSkill = path.join(skillRoot, 'user-owned-during-run');
      fs.mkdirSync(userSkill);
      controller.abort();
      const result = await running;

      expect(result.outcome).toBe(RunOutcome.Aborted);
      expect(result.failure?.code).toBe(ErrorCodes.AgentAbort);
      expect(postRun).not.toHaveBeenCalled();
      expect(events.some((event) => event.kind === 'completion')).toBe(false);
      expect(fs.existsSync(path.join(tmp, QUEUE_DIR_NAME))).toBe(false);
      expect(fs.existsSync(runSkill)).toBe(false);
      expect(fs.existsSync(userSkill)).toBe(true);
      expect(fs.existsSync(preexistingSkill)).toBe(true);
      expect(flushScanReport).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    [Harness.pi, Sequence.linear],
    [Harness.anthropic, Sequence.linear],
    [Harness.pi, Sequence.orchestrator],
    [Harness.anthropic, Sequence.orchestrator],
  ])(
    'waits for the answer before completing %s %s',
    async (harness, sequence) => {
      harnessState.askQuestions = [
        { id: 'q1', prompt: 'Continue?', kind: 'text' },
      ];
      let release: ((answers: AskAnswers) => void) | undefined;
      const ask = vi.fn(
        () =>
          new Promise<AskAnswers>((resolve) => {
            release = resolve;
          }),
      );
      const events: AgentProgress[] = [];
      let settled = false;
      const running = runAgent(
        config({
          binding: { harness, sequence, model: DEFAULT_AGENT_MODEL },
        }),
        input(),
        { interaction: { ask }, onProgress: (event) => events.push(event) },
      ).then((result) => {
        settled = true;
        return result;
      });

      try {
        await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(settled).toBe(false);
        expect(events.some((event) => event.kind === 'completion')).toBe(false);
        expect(analytics.shutdown).not.toHaveBeenCalled();
        expect(flushScanReport).not.toHaveBeenCalled();
      } finally {
        release?.({ q1: 'yes' });
      }

      const result = await running;
      expect(result.outcome).toBe(RunOutcome.Success);
      expect(result.snapshot.statusMessages).toContain('answered:{"q1":"yes"}');
      expect(analytics.shutdown).not.toHaveBeenCalled();
      expect(flushScanReport).toHaveBeenCalledTimes(1);
    },
  );

  it.each([Sequence.linear, Sequence.orchestrator])(
    'does not wait for disabled questions in %s',
    async (sequence) => {
      harnessState.askQuestions = [
        { id: 'q1', prompt: 'Continue?', kind: 'text' },
      ];
      const ask = vi.fn(() =>
        Promise.reject(new Error('disabled answerer called')),
      );
      const runConfig = config({
        binding: { harness: Harness.pi, sequence, model: DEFAULT_AGENT_MODEL },
      });
      const runInput = input();
      runInput.flags.ci = true;
      vi.stubEnv('WIZARD_ASK_AUTODRIVE', '');
      try {
        const result = await runAgent(runConfig, runInput, {
          interaction: { ask },
        });
        expect(result.outcome).toBe(RunOutcome.Success);
        expect(ask).not.toHaveBeenCalled();
        const inputs =
          sequence === Sequence.linear
            ? (harnessState.lastInputs as BackendRunInputs)
            : harnessState.tasks.at(-1);
        expect(inputs?.askBridge).toBeUndefined();
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );

  it.each([Harness.pi, Harness.anthropic])(
    'dispatches %s through both sequence arms',
    async (harness) => {
      for (const sequence of [Sequence.linear, Sequence.orchestrator]) {
        const result = await runAgent(
          config({
            binding: { harness, sequence, model: DEFAULT_AGENT_MODEL },
          }),
          input(),
        );
        expect(result.outcome).toBe('success');
        expect(harnessState.selected.at(-1)).toBe(harness);
        if (sequence === Sequence.linear) {
          expect(harnessState.tasks).toHaveLength(0);
        } else {
          expect(harnessState.tasks).toHaveLength(2);
          expect(
            harnessState.tasks[1].orchestrator.currentTaskId,
          ).toBeDefined();
          expect(result.snapshot.tasks).toEqual([
            { content: 'install', activeForm: 'install', status: 'completed' },
          ]);
        }
      }
      // Terminal analytics belong to the process, so to the host.
      expect(analytics.shutdown).not.toHaveBeenCalled();
    },
  );

  it('keeps an explicit orchestrator route as a hard error without runTask', async () => {
    harnessState.taskCapability = false;
    const result = await runAgent(
      config({
        binding: {
          harness: Harness.anthropic,
          sequence: Sequence.orchestrator,
          model: DEFAULT_AGENT_MODEL,
        },
      }),
      input(),
    );
    expect(result.outcome).toBe(RunOutcome.Crashed);
    expect(result.failure?.error?.message).toContain(
      'does not implement runTask; orchestrator mode requires it',
    );
  });

  it('cleans up when the seed fails before the drain starts', async () => {
    const failure = {
      code: ErrorCodes.AgentApiError,
      message: 'Authentication failed (401)',
    };
    harnessState.seedFailure = failure;
    const result = await runAgent(
      config({
        binding: {
          harness: Harness.anthropic,
          sequence: Sequence.orchestrator,
          model: DEFAULT_AGENT_MODEL,
        },
      }),
      input(),
    );
    expect(result.outcome).toBe('failed');
    expect(result.failure).toBe(failure);
    expect(harnessState.tasks).toHaveLength(1);
    expect(fs.existsSync(path.join(tmp, QUEUE_DIR_NAME))).toBe(false);
  });

  it('returns an anthropic orchestrator task failure and cleans up the queue', async () => {
    const failure = {
      code: ErrorCodes.AgentAbort,
      message: 'Authentication failed (401)',
    };
    harnessState.taskFailure = failure;
    const result = await runAgent(
      config({
        binding: {
          harness: Harness.anthropic,
          sequence: Sequence.orchestrator,
          model: DEFAULT_AGENT_MODEL,
        },
      }),
      input(),
    );
    expect(result.outcome).toBe('failed');
    expect(result.failure).toBe(failure);
    expect(harnessState.tasks).toHaveLength(2);
    expect(fs.existsSync(path.join(tmp, QUEUE_DIR_NAME))).toBe(false);
  });

  it('treats a coded task harness rejection as run-fatal without retrying', async () => {
    const error = new WizardError(
      'Gateway rejected the request',
      {},
      ErrorCodes.AgentApiError,
    );
    harnessState.taskThrow = error;
    const result = await runAgent(
      config({
        binding: {
          harness: Harness.pi,
          sequence: Sequence.orchestrator,
          model: DEFAULT_AGENT_MODEL,
        },
      }),
      input(),
    );
    expect(result.outcome).toBe('failed');
    expect(result.failure).toMatchObject({
      code: ErrorCodes.AgentApiError,
      message: error.message,
    });
    expect(result.failure?.error).toBe(error);
    expect(harnessState.tasks).toHaveLength(2);
    expect(fs.existsSync(path.join(tmp, QUEUE_DIR_NAME))).toBe(false);
  });

  it('cancels a sibling task’s open question when another task fails the run', async () => {
    const failure = {
      code: ErrorCodes.AgentApiError,
      message: 'Gateway rejected the request',
    };
    const signals: AbortSignal[] = [];
    const answers: AskAnswers[] = [];
    let questionOpened!: () => void;
    const opened = new Promise<void>((resolve) => {
      questionOpened = resolve;
    });
    harnessState.seedTasks = 2;
    let started = 0;
    harnessState.task = async (inputs) => {
      if (started++ === 0) {
        if (!inputs.askBridge) throw new Error('the install task can ask');
        const response = await inputs.askBridge.request({
          questions: [{ id: 'q1', prompt: 'Key?', kind: 'text' }],
        });
        answers.push(response.answers);
        return { kind: 'success' };
      }
      await opened;
      return { kind: 'decided_failure', failure };
    };
    const result = await runAgent(
      config({
        binding: {
          harness: Harness.pi,
          sequence: Sequence.orchestrator,
          model: DEFAULT_AGENT_MODEL,
        },
      }),
      input(),
      {
        interaction: {
          // Nobody answers: only the sibling's failure can end this question.
          ask: (_question, { signal }) => {
            signals.push(signal);
            questionOpened();
            return new Promise<AskAnswers>(() => undefined);
          },
        },
      },
    );
    expect(result.outcome).toBe(RunOutcome.Failed);
    expect(result.failure).toMatchObject(failure);
    // The question's own signal aborted, so the host dismisses its overlay,
    // and the ask settled as cancelled, so its task joined the drain.
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(true);
    expect(answers).toEqual([{ q1: CANCELLED_SENTINEL }]);
  });

  it('reports the steps a fatal task result stopped', async () => {
    const failure = {
      code: ErrorCodes.AgentApiError,
      message: 'Gateway rejected the request',
    };
    harnessState.task = ({ orchestrator }) => {
      if (!orchestrator.currentTaskId)
        throw new Error('a drained task has an id');
      // A step that waits on this one, so the fatal result leaves it pending.
      orchestrator.store.enqueue({
        type: 'report',
        dependsOn: [orchestrator.currentTaskId],
      });
      return Promise.resolve<AgentResult>({ kind: 'decided_failure', failure });
    };
    const result = await runAgent(
      config({
        binding: {
          harness: Harness.pi,
          sequence: Sequence.orchestrator,
          model: DEFAULT_AGENT_MODEL,
        },
      }),
      input(),
    );
    expect(result.outcome).toBe(RunOutcome.Failed);
    expect(result.failure).toBe(failure);
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'orchestrator task blocked',
      { type: 'report', optional: false, failed_types: 'install' },
    );
  });

  it('keeps a fatal task result when reporting its blocked steps throws', async () => {
    const failure = {
      code: ErrorCodes.AgentApiError,
      message: 'Gateway rejected the request',
    };
    harnessState.task = ({ orchestrator }) => {
      if (!orchestrator.currentTaskId)
        throw new Error('a drained task has an id');
      orchestrator.store.enqueue({
        type: 'report',
        dependsOn: [orchestrator.currentTaskId],
      });
      return Promise.resolve<AgentResult>({ kind: 'decided_failure', failure });
    };
    vi.mocked(analytics.wizardCapture).mockImplementation((event) => {
      if (event === 'orchestrator task blocked') {
        throw new Error('analytics down');
      }
    });
    try {
      const result = await runAgent(
        config({
          binding: {
            harness: Harness.pi,
            sequence: Sequence.orchestrator,
            model: DEFAULT_AGENT_MODEL,
          },
        }),
        input(),
      );
      expect(result.outcome).toBe(RunOutcome.Failed);
      expect(result.failure).toBe(failure);
    } finally {
      vi.mocked(analytics.wizardCapture).mockReset();
    }
  });

  it('cancels an open question when the linear harness ends the run', async () => {
    const signals: AbortSignal[] = [];
    let response: Promise<AskResponse> | undefined;
    harnessState.run = (inputs) => {
      // A parallel tool call is still waiting on the user when a violation
      // ends the run.
      if (!inputs.askBridge) throw new Error('the linear run can ask');
      response = inputs.askBridge.request({
        questions: [{ id: 'q1', prompt: 'Key?', kind: 'text' }],
      });
      return Promise.resolve<AgentResult>({
        kind: 'failure',
        classification: AgentErrorType.YARA_VIOLATION,
      });
    };
    const result = await runAgent(config(), input(), {
      interaction: {
        // Nobody answers: only the run ending can close this question.
        ask: (_question, { signal }) => {
          signals.push(signal);
          return new Promise<AskAnswers>(() => undefined);
        },
      },
    });
    expect(result.outcome).toBe(RunOutcome.Failed);
    expect(result.failure?.code).toBe(
      AGENT_ERROR_CODE[AgentErrorType.YARA_VIOLATION],
    );
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(true);
    await expect(response).resolves.toEqual({
      answers: { q1: CANCELLED_SENTINEL },
      timedOut: false,
    });
  });

  it.each([Sequence.linear, Sequence.orchestrator])(
    'preserves %s completion and scan-flush ordering and leaves the shutdown to the host',
    async (sequence) => {
      const order: string[] = [];
      vi.mocked(analytics.shutdown).mockImplementationOnce(() => {
        order.push('shutdown');
        return Promise.resolve();
      });
      vi.mocked(flushScanReport).mockImplementationOnce(() => {
        order.push('scan-flush');
        return undefined;
      });
      const result = await runAgent(
        config({
          binding: {
            harness: Harness.pi,
            sequence,
            model: DEFAULT_AGENT_MODEL,
          },
        }),
        input(),
        {
          onProgress: (event) => {
            if (event.kind === 'completion') {
              order.push(
                fs.existsSync(path.join(tmp, QUEUE_DIR_NAME))
                  ? 'queue-present'
                  : 'queue-clean',
              );
              order.push('completion');
            }
            if (event.kind === 'lifecycle' && event.phase === 'completed')
              order.push('outro');
          },
        },
      );
      expect(result.outcome).toBe('success');
      expect(order).toEqual([
        'queue-clean',
        'completion',
        'outro',
        'scan-flush',
      ]);
    },
  );

  it('runs to success with an observer and an answerer', async () => {
    const events: AgentProgress[] = [];
    const ask = vi.fn(() => Promise.resolve({ q1: 'yes' }));
    harnessState.askQuestions = [
      { id: 'q1', prompt: 'Continue?', kind: 'single' as const },
    ];

    const result = await runAgent(config(), input(), {
      onProgress: (e) => events.push(e),
      interaction: { ask },
    });

    expect(result.outcome).toBe('success');
    expect(result.skillId).toBe('test-integration');
    expect(result.outro).toEqual({
      kind: OutroKind.Success,
      message: 'Done!',
      reportFile: 'report.md',
      docsUrl: 'https://docs.test',
      continueUrl: undefined,
    });
    expect(result.failure).toBeUndefined();

    // The answerer saw the question the bridge built, with that question's own
    // signal, and its answer came back.
    expect(ask).toHaveBeenCalledTimes(1);
    const [question, context] = ask.mock.calls[0] as unknown as [
      PendingQuestion,
      { signal: AbortSignal },
    ];
    expect(question.questions[0].id).toBe('q1');
    expect(question.source).toBe('test-integration');
    expect(context.signal.aborted).toBe(false);
    expect(events).toContainEqual({
      kind: 'status',
      message: 'answered:{"q1":"yes"}',
    });

    // Emission order: started first, completion then completed last.
    const kinds = events.map(
      (e) => `${e.kind}${'phase' in e ? `:${e.phase}` : ''}`,
    );
    expect(kinds[0]).toBe('lifecycle:started');
    expect(kinds.slice(-2)).toEqual(['completion', 'lifecycle:completed']);

    // The agent's own snapshot, independent of the observer.
    expect(result.snapshot.dashboardUrl).toBe('https://d/1');
    expect(result.snapshot.notebookUrl).toBe('https://n/1');
    expect(result.snapshot.stage).toBe('Configure');
    expect(result.snapshot.finalCostUsd).toBe(0.25);
    expect(result.snapshot.tasks).toEqual([
      { content: 'Install', status: 'completed' },
    ]);
    expect(result.snapshot.statusMessages[0]).toBe('Installing the SDK');
    expect(result.snapshot.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    expect(analytics.shutdown).not.toHaveBeenCalled();
  });

  it('a process drain during a run writes the scan report once, through progress', async () => {
    clearCleanup();
    harnessState.waitForAbort = true;
    vi.mocked(flushScanReport).mockReturnValueOnce(
      'YARA scan report: /tmp/scan.json',
    );
    const controller = new AbortController();
    const events: AgentProgress[] = [];
    const running = runAgent(
      config(),
      input({ flags: { ...input().flags, yaraReport: true } }),
      {
        signal: controller.signal,
        onProgress: (event) => events.push(event),
      },
    );
    await vi.waitFor(() => expect(harnessState.lastInputs).toBeTruthy());

    runCleanups();

    expect(flushScanReport).toHaveBeenCalledExactlyOnceWith({
      yaraReport: true,
    });
    expect(events).toContainEqual({
      kind: 'log',
      level: 'info',
      message: 'YARA scan report: /tmp/scan.json',
    });
    controller.abort();
    expect((await running).outcome).toBe(RunOutcome.Aborted);
    expect(flushScanReport).toHaveBeenCalledTimes(1);
    expect(
      events.filter(
        (event) =>
          event.kind === 'log' && event.message.startsWith('YARA scan report'),
      ),
    ).toHaveLength(1);
  });

  it('runs to a complete result with no options at all', async () => {
    const result = await runAgent(config(), input());

    expect(result.outcome).toBe('success');
    expect(result.outro?.kind).toBe(OutroKind.Success);
    expect(result.snapshot.dashboardUrl).toBe('https://d/1');
    // No answerer: no bridge is installed, so `wizard_ask` reports unavailable
    // rather than hanging.
    const inputs = harnessState.lastInputs as BackendRunInputs;
    expect(inputs.askBridge).toBeUndefined();
  });

  it('installs no bridge in CI even with an answerer, as before', async () => {
    await runAgent(
      config(),
      input({
        flags: {
          ci: true,
          signup: false,
          debug: false,
          e2eAsk: false,
          localMcp: false,
          captureAio: false,
          benchmark: false,
          yaraReport: false,
        },
      }),
      { interaction: { ask: () => Promise.resolve({}) } },
    );
    const inputs = harnessState.lastInputs as BackendRunInputs;
    expect(inputs.askBridge).toBeUndefined();
  });

  it('returns an agent abort as a decided failure with the matched case', async () => {
    harnessState.result = {
      kind: 'abort',
      classification: AgentErrorType.ABORT,
      message: 'No Stripe found',
    };
    const events: AgentProgress[] = [];

    const result = await runAgent(config(), input(), {
      onProgress: (e) => events.push(e),
    });

    // The agent stopped itself; only the host's signal makes a run aborted.
    expect(result.outcome).toBe(RunOutcome.Failed);
    expect(result.failure?.code).toBe(ErrorCodes.AgentAbort);
    expect(result.failure?.outroData).toMatchObject({
      kind: OutroKind.Error,
      message: 'No Stripe here',
      body: 'Stripe is required.',
      errorDetail: { reason: 'No Stripe found' },
    });
    expect(result.failure?.error).toBeUndefined();
    expect(events.some((e) => e.kind === 'completion')).toBe(false);
    expect(analytics.shutdown).not.toHaveBeenCalled();
  });

  it('returns a coded failure for a harness error', async () => {
    harnessState.result = {
      kind: 'failure',
      classification: AgentErrorType.NO_PROGRESS,
    };

    const result = await runAgent(config(), input());

    expect(result.outcome).toBe('failed');
    expect(result.failure?.code).toBe(
      AGENT_ERROR_CODE[AgentErrorType.NO_PROGRESS],
    );
    expect(result.failure?.message).toContain('without changing your project');
  });

  it('resolves a crash even when the thrown Error has hostile getters', async () => {
    const hostile = new Error('hidden');
    Object.defineProperty(hostile, 'message', {
      get() {
        throw new Error('message getter');
      },
    });
    harnessState.throws = hostile;
    const result = await runAgent(config(), input());
    expect(result.outcome).toBe(RunOutcome.Crashed);
    expect(result.failure?.error).toBe(hostile);
    expect(result.failure?.code).toBe(ErrorCodes.InternalUnhandled);
  });

  it('passes a harness-decided failure through untouched', async () => {
    const failure = { code: ErrorCodes.AgentAbort, message: 'decided' };
    harnessState.result = { kind: 'decided_failure', failure };

    const result = await runAgent(config(), input());

    expect(result.outcome).toBe('failed');
    expect(result.failure).toBe(failure);
  });

  it('skips the terminal outro for a composed sub-run', async () => {
    const events: AgentProgress[] = [];

    const result = await runAgent(config({ composed: true }), input(), {
      onProgress: (e) => events.push(e),
    });

    expect(result.outcome).toBe('success');
    expect(result.outro).toBeUndefined();
    expect(events.some((e) => e.kind === 'completion')).toBe(false);
    expect(
      events.some((e) => e.kind === 'lifecycle' && e.phase === 'completed'),
    ).toBe(false);
    expect(analytics.shutdown).not.toHaveBeenCalled();
  });

  it('finishes when the observer throws on every event', async () => {
    const result = await runAgent(config(), input(), {
      onProgress: () => {
        throw new Error('projection broke');
      },
    });

    expect(result.outcome).toBe('success');
    expect(result.snapshot.tasks).toHaveLength(1);
  });

  it('finishes when an async observer rejects', async () => {
    const result = await runAgent(config(), input(), {
      onProgress: () => Promise.reject(new Error('observer rejected')),
    });
    expect(result.outcome).toBe(RunOutcome.Success);
    expect(result.snapshot.tasks).toHaveLength(1);
  });

  it.each([Sequence.linear, Sequence.orchestrator])(
    'cancels an open question when the host aborts the %s run',
    async (sequence) => {
      harnessState.askQuestions = [
        { id: 'q1', prompt: 'Continue?', kind: 'text' },
      ];
      const host = new AbortController();
      const signals: AbortSignal[] = [];
      const running = runAgent(
        config({
          binding: {
            harness: Harness.pi,
            sequence,
            model: DEFAULT_AGENT_MODEL,
          },
        }),
        input(),
        {
          signal: host.signal,
          interaction: {
            ask: (_question, { signal }) => {
              signals.push(signal);
              return new Promise<AskAnswers>(() => undefined);
            },
          },
        },
      );
      await vi.waitFor(() => expect(signals).toHaveLength(1));
      expect(signals[0].aborted).toBe(false);
      host.abort();
      const result = await running;
      expect(result.outcome).toBe(RunOutcome.Aborted);
      // The host's abort reached the open question as its own abort.
      expect(signals[0].aborted).toBe(true);
    },
  );

  it('returns an aborted result before setup for a pre-aborted host signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runAgent(config(), input(), {
      signal: controller.signal,
    });
    expect(result.outcome).toBe(RunOutcome.Aborted);
    expect(result.failure?.code).toBe(ErrorCodes.AgentAbort);
    expect(harnessState.lastInputs).toBeUndefined();
  });

  it('calls the bound hooks with the run credentials', async () => {
    const postRun = vi.fn().mockResolvedValue(undefined);
    const buildOutroData = vi.fn(() => ({
      kind: OutroKind.Success,
      message: 'custom',
    }));

    const result = await runAgent(
      config({ hooks: { postRun, buildOutroData } }),
      input(),
    );

    expect(postRun).toHaveBeenCalledWith(
      expect.objectContaining({ projectApiKey: 'phc_test' }),
    );
    expect(buildOutroData).toHaveBeenCalledTimes(1);
    expect(result.outro).toEqual({
      kind: OutroKind.Success,
      message: 'custom',
    });
  });

  it('returns a crash as a result instead of rejecting', async () => {
    const boom = new Error('SDK exploded');
    harnessState.throws = boom;

    const result = await runAgent(config(), input());

    expect(result.outcome).toBe('crashed');
    expect(result.failure?.error).toBe(boom);
    expect(result.failure?.message).toBe('SDK exploded');
    expect(result.failure?.code).toBe(ErrorCodes.InternalUnhandled);
    // What was reported before the crash survives in the snapshot.
    expect(result.snapshot.statusMessages).toContain('Installing the SDK');
  });

  it.each([
    [
      // The agent stopped itself; only the host's signal makes a run aborted.
      'an agent [ABORT]',
      'failed',
      {
        kind: 'abort',
        classification: AgentErrorType.ABORT,
        message: 'No Stripe found',
      },
      undefined,
    ],
    [
      'a failure',
      'failed',
      { kind: 'failure', classification: AgentErrorType.NO_PROGRESS },
      undefined,
    ],
    ['a crash', 'crashed', { kind: 'success' }, new Error('SDK exploded')],
  ] as const)(
    'removes only new Wizard-installed skills after %s',
    async (_ending, outcome, harnessResult, thrown) => {
      const skillsDir = path.join(tmp, '.claude', 'skills');
      const makeSkill = (id: string, marked: boolean) => {
        const dir = path.join(skillsDir, id);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'SKILL.md'), '# skill');
        if (marked) fs.writeFileSync(path.join(dir, '.posthog-wizard'), '');
      };
      makeSkill('preexisting', true);
      harnessState.result = harnessResult;
      harnessState.throws = thrown;

      const result = await runAgent(config(), input(), {
        onProgress: (event) => {
          if (event.kind !== 'status') return;
          makeSkill('installed-this-run', true);
          makeSkill('user-owned-this-run', false);
        },
      });

      expect(result.outcome).toBe(outcome);
      expect(fs.readdirSync(skillsDir).sort()).toEqual([
        'preexisting',
        'user-owned-this-run',
      ]);
    },
  );

  it('removes a new marked skill when preparation fails before the harness starts', async () => {
    const skillsDir = path.join(tmp, '.claude', 'skills');
    const failedInput = input({
      inferenceAuth: {
        resolve: () => {
          const dir = path.join(skillsDir, 'installed-during-preparation');
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, '.posthog-wizard'), '');
          return Promise.reject(new Error('preparation blocked the run'));
        },
      },
    });

    const result = await runAgent(config(), failedInput);

    expect(result.outcome).toBe(RunOutcome.Crashed);
    expect(harnessState.lastInputs).toBeUndefined();
    expect(
      fs.existsSync(path.join(skillsDir, 'installed-during-preparation')),
    ).toBe(false);
  });

  it('rejects a standalone agent run without a caller-owned inference provider', async () => {
    const missingProvider = input();
    delete (missingProvider as Partial<RunInput>).inferenceAuth;

    const result = await runAgent(config(), missingProvider);

    expect(result.outcome).toBe(RunOutcome.Crashed);
    expect(result.failure?.message).toContain(
      'Inference auth provider is required',
    );
    expect(harnessState.lastInputs).toBeUndefined();
  });

  it('keeps newly installed skills after a successful run', async () => {
    const skillDir = path.join(tmp, '.claude', 'skills', 'completed-install');
    const result = await runAgent(config(), input(), {
      onProgress: (event) => {
        if (event.kind !== 'status') return;
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(path.join(skillDir, '.posthog-wizard'), '');
      },
    });

    expect(result.outcome).toBe(RunOutcome.Success);
    expect(fs.existsSync(skillDir)).toBe(true);
  });
});
