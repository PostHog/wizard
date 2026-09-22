import { runNonInteractive } from '@lib/runners/run-non-interactive';
import { authenticate } from '@programs/authenticate';
import { runProgramAgent } from '../run-agent-legacy';
import { runAgent, RunOutcome, type RunResult } from '@agent/runner';
import { Harness, Sequence } from '@shared/constants';
import { buildSession, OutroKind } from '@lib/wizard-session';
import { HostResolution } from '@shared/host-resolution';
import { LoggingUI } from '@ui/logging-ui';
import { setUI } from '@ui';
import { analytics } from '@utils/analytics';
import { initLogFile } from '@utils/debug';
import { wizardAbort } from '@utils/wizard-abort';
import type { ProgramConfig } from '../program-step';

const streamShutdown = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@env', async (original) => ({
  ...(await original<typeof import('@env')>()),
  IS_PRODUCTION_BUILD: false,
}));
vi.mock('@shared/local-dev', async (original) => ({
  ...(await original<typeof import('@shared/local-dev')>()),
  checkLocalServices: vi.fn().mockResolvedValue(null),
}));
vi.mock('@utils/environment', async (original) => ({
  ...(await original<typeof import('@utils/environment')>()),
  readEnvironment: () => ({}),
}));
vi.mock('@agent/gateway-session', async (original) => ({
  ...(await original<typeof import('@agent/gateway-session')>()),
  configureGatewayFromCIEnvironment: vi.fn(),
}));
vi.mock('@programs/task-stream/index', () => ({
  TaskStreamPush: class {
    attach = vi.fn();
    shutdown = streamShutdown;
  },
  PostHogDestination: class {},
  createFileDestination: () => null,
}));
vi.mock('@utils/debug');
vi.mock('@utils/analytics', () => ({
  analytics: {
    build: 'test',
    runId: 'run-1',
    wizardCapture: vi.fn(),
    setTag: vi.fn(),
    getAllFlagsForWizard: vi.fn().mockResolvedValue({}),
    getWizardFlagPayloads: vi.fn().mockReturnValue({}),
    shutdown: vi.fn().mockResolvedValue(undefined),
  },
  sessionProperties: () => ({}),
}));
vi.mock('@agent/runner', async (original) => ({
  ...(await original<typeof import('@agent/runner')>()),
  runAgent: vi.fn(),
}));
vi.mock('@programs/authenticate', () => ({
  authenticate: vi.fn().mockResolvedValue(undefined),
  refreshAccessTokenIfNeeded: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@shared/claude-settings', () => ({
  checkAllSettingsConflicts: vi.fn().mockReturnValue([]),
  restoreClaudeSettings: vi.fn(),
}));
vi.mock('@utils/wizard-abort', async (original) => ({
  ...(await original<typeof import('@utils/wizard-abort')>()),
  registerCleanup: vi.fn(),
  wizardAbort: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../posthog-integration/detect', () => ({
  maybeStampAiSdkDetected: vi.fn(),
}));

const program = (id: ProgramConfig['id'] = 'metrics'): ProgramConfig => ({
  id,
  steps: [],
  description: 'Test',
  run: {
    integrationLabel: 'test',
    spinnerMessage: 'Working',
    successMessage: 'Done',
    estimatedDurationMinutes: 1,
    reportFile: 'report.md',
    docsUrl: 'https://docs.test',
  },
});
const snapshot = {
  tasks: [],
  statusMessages: [],
  usage: {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  },
};
const session = () => ({
  ...buildSession({ ci: true, installDir: '/tmp/adapter-test' }),
  credentials: {
    accessToken: 'test',
    projectApiKey: 'phc_test',
    projectId: 1,
    host: HostResolution.fromApiHost('https://us.posthog.com'),
  },
});

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authenticate).mockImplementation((sess) => {
    sess.credentials = session().credentials;
    return Promise.resolve();
  });
  setUI(new LoggingUI());
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.mocked(runAgent).mockImplementation((_config, _input, options) => {
    options?.onProgress?.({ kind: 'status', message: 'Working' });
    options?.onProgress?.({
      kind: 'completion',
      outro: { kind: OutroKind.Success, message: 'Done' },
    });
    options?.onProgress?.({
      kind: 'lifecycle',
      phase: 'completed',
      message: 'Done',
    });
    return Promise.resolve({ outcome: RunOutcome.Success, snapshot });
  });
});
afterEach(() => logSpy.mockRestore());

it.each([
  ['metrics', Harness.pi, Sequence.orchestrator],
  ['replay-vision', Harness.anthropic, Sequence.orchestrator],
] as const)(
  'forwards the %s program binding through the real adapter',
  async (id, harness, sequence) => {
    await runProgramAgent(program(id), session());
    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        programId: id,
        binding: expect.objectContaining({ harness, sequence }),
      }),
      expect.objectContaining({ flags: expect.objectContaining({ ci: true }) }),
      expect.objectContaining({
        onProgress: expect.any(Function),
        interaction: expect.any(Object),
      }),
    );
    expect(logSpy).toHaveBeenCalledWith('◇  Working');
    expect(logSpy).toHaveBeenCalledWith('└  Done');
    expect(initLogFile).toHaveBeenCalledOnce();
    expect(analytics.shutdown).not.toHaveBeenCalled();
  },
);

it('clamps a composed program to linear and keeps host analytics alive', async () => {
  await runProgramAgent(program(), session(), { composed: true });
  expect(runAgent).toHaveBeenCalledWith(
    expect.objectContaining({
      composed: true,
      binding: expect.objectContaining({ sequence: Sequence.linear }),
    }),
    expect.anything(),
    expect.anything(),
  );
  expect(analytics.shutdown).not.toHaveBeenCalled();
});

it.each([RunOutcome.Aborted, RunOutcome.Failed] as const)(
  'passes a %s result to the existing abort handler',
  async (outcome) => {
    const failure = { message: 'Failed', exitCode: 2 };
    vi.mocked(runAgent).mockResolvedValue({ outcome, failure, snapshot });
    await runProgramAgent(program(), session());
    expect(wizardAbort).toHaveBeenCalledExactlyOnceWith(failure);
    expect(analytics.shutdown).not.toHaveBeenCalled();
  },
);

it('rethrows the original crash for the outer runner', async () => {
  const error = new Error('mint refused');
  const result: RunResult = {
    outcome: RunOutcome.Crashed,
    failure: { error },
    snapshot,
  };
  vi.mocked(runAgent).mockResolvedValue(result);
  await expect(runProgramAgent(program(), session())).rejects.toBe(error);
  expect(wizardAbort).not.toHaveBeenCalled();
  expect(analytics.shutdown).not.toHaveBeenCalled();
});

it.each([
  [Harness.pi, Sequence.linear],
  [Harness.pi, Sequence.orchestrator],
  [Harness.anthropic, Sequence.linear],
  [Harness.anthropic, Sequence.orchestrator],
])(
  'runs headless %s/%s through the real CLI adapter',
  async (harness, sequence) => {
    runNonInteractive(
      program(),
      {
        apiKey: 'phx_test',
        projectId: '1',
        installDir: '/tmp/adapter-test',
        telemetry: false,
        harness,
        sequence,
      },
      'headless',
    );
    await vi.waitFor(() => expect(streamShutdown).toHaveBeenCalledOnce());
    expect(wizardAbort).not.toHaveBeenCalled();
    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        binding: expect.objectContaining({ harness, sequence }),
      }),
      expect.objectContaining({ flags: expect.objectContaining({ ci: true }) }),
      expect.anything(),
    );
    expect(logSpy).toHaveBeenCalledWith('◇  Working');
    expect(logSpy).toHaveBeenCalledWith('└  Done');
  },
);
