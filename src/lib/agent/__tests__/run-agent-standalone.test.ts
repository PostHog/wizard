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
import { Harness, Sequence } from '@lib/constants';
import { HostResolution } from '@lib/host-resolution';
import { OutroKind, type PendingQuestion } from '@lib/wizard-session';
import { AGENT_ERROR_CODE, ErrorCodes } from '@lib/errors';
import { AgentErrorType } from '@lib/agent/signals';
import type { AgentProgress } from '@lib/agent/progress';
import type {
  AgentHarness,
  BackendRunInputs,
} from '@lib/agent/runner/harness/types';

vi.mock('@ui', () => ({
  getUI: () => {
    throw new Error('the agent reached for getUI()');
  },
  setUI: () => {
    throw new Error('the agent reached for setUI()');
  },
}));
vi.mock('@utils/debug');
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
vi.mock('@lib/gateway-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@lib/gateway-session')>()),
  gatewayAuth: vi.fn().mockResolvedValue({
    gatewayUrl: 'https://gateway.test',
    token: 'phe_run',
    teamId: 1,
    refreshAtMs: Date.now() + 3_600_000,
  }),
}));

// The fake harness: reports a little of everything, then returns what the
// current test told it to.
const harnessState = vi.hoisted(() => ({
  result: {} as { error?: string; message?: string; failure?: unknown },
  throws: undefined as Error | undefined,
  lastInputs: undefined as unknown,
  askQuestions: undefined as PendingQuestion['questions'] | undefined,
}));
vi.mock('@lib/agent/runner/switchboard/harness', () => {
  const fake: AgentHarness = {
    name: Harness.pi,
    async run(inputs: BackendRunInputs) {
      harnessState.lastInputs = inputs;
      const { emit, spinner } = inputs;
      emit({ kind: 'log', level: 'step', message: 'Initializing agent' });
      spinner.start('Working');
      emit({ kind: 'status', message: 'Installing the SDK' });
      emit({
        kind: 'tasks',
        tasks: [{ content: 'Install', status: 'completed' }],
      });
      emit({ kind: 'url', which: 'dashboard', url: 'https://d/1' });
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
      if (harnessState.askQuestions && inputs.askBridge) {
        const { answers } = await inputs.askBridge.request({
          questions: harnessState.askQuestions,
        });
        emit({
          kind: 'status',
          message: `answered:${JSON.stringify(answers)}`,
        });
      }
      if (harnessState.throws) throw harnessState.throws;
      spinner.stop('Done');
      return harnessState.result as never;
    },
  };
  return {
    HARNESS_OPTIONS: { [Harness.pi]: fake },
    getHarness: () => fake,
    resolveHarness: () => ({ harness: Harness.pi, model: 'm' }),
  };
});

import { runAgent } from '@lib/agent/runner';
import type { RunConfig, RunInput } from '@lib/agent/runner';
import { analytics } from '@utils/analytics';

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
  switchboard: { program: 'test-program', flags: {} },
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
  harnessState.result = {};
  harnessState.throws = undefined;
  harnessState.lastInputs = undefined;
  harnessState.askQuestions = undefined;
  vi.mocked(analytics.shutdown).mockClear();
});

afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('runAgent standalone', () => {
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

    // The answerer saw the question the bridge built, and its answer came back.
    expect(ask).toHaveBeenCalledTimes(1);
    const [question] = ask.mock.calls[0] as unknown as [PendingQuestion];
    expect(question.questions[0].id).toBe('q1');
    expect(question.source).toBe('test-integration');
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
    expect(analytics.shutdown).toHaveBeenCalledWith('success');
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
      error: AgentErrorType.ABORT,
      message: 'No Stripe found',
    };
    const events: AgentProgress[] = [];

    const result = await runAgent(config(), input(), {
      onProgress: (e) => events.push(e),
    });

    expect(result.outcome).toBe('aborted');
    expect(result.failure?.code).toBe(ErrorCodes.AgentAbort);
    expect(result.failure?.outroData).toMatchObject({
      kind: OutroKind.Error,
      message: 'No Stripe here',
      body: 'Stripe is required.',
      errorDetail: { reason: 'No Stripe found' },
    });
    expect(result.failure?.error?.message).toBe(
      'Agent aborted: No Stripe found',
    );
    expect(events.some((e) => e.kind === 'completion')).toBe(false);
    expect(analytics.shutdown).not.toHaveBeenCalled();
  });

  it('returns a coded failure for a harness error', async () => {
    harnessState.result = { error: AgentErrorType.NO_PROGRESS };

    const result = await runAgent(config(), input());

    expect(result.outcome).toBe('failed');
    expect(result.failure?.code).toBe(
      AGENT_ERROR_CODE[AgentErrorType.NO_PROGRESS],
    );
    expect(result.failure?.message).toContain('without changing your project');
  });

  it('passes a harness-decided failure through untouched', async () => {
    const failure = { code: ErrorCodes.AgentAbort, message: 'decided' };
    harnessState.result = { failure };

    const result = await runAgent(config(), input());

    expect(result.outcome).toBe('failed');
    expect(result.failure).toBe(failure);
  });

  it('skips the terminal outro and the shutdown for a composed sub-run', async () => {
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

  it('is cancelled by a signal that is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await runAgent(config(), input(), {
      signal: controller.signal,
    });

    expect(result.outcome).toBe('cancelled');
    expect(harnessState.lastInputs).toBeUndefined();
  });
});
