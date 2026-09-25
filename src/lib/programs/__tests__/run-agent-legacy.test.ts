import fs from 'fs';
import os from 'os';
import path from 'path';
import { runNonInteractive } from '@lib/runners/run-non-interactive';
import { runWizard } from '@lib/runners/run-wizard';
import { authenticate } from '@lib/programs/authenticate';
import { runProgramAgent } from '../run-agent-legacy';
import { runAgent, RunOutcome, type RunResult } from '@agent/runner';
import { Harness, Sequence } from '@shared/constants';
import { buildSession, OutroKind } from '@lib/wizard-session';
import { HostResolution } from '@shared/host-resolution';
import { LoggingUI } from '@ui/logging-ui';
import { InkUI } from '@ui/tui/ink-ui';
import { startTUI } from '@ui/tui/start-tui';
import { WizardStore } from '@ui/tui/store';
import { getUI, setUI } from '@ui';
import { analytics } from '@utils/analytics';
import { initLogFile, logToFile } from '@utils/debug';
import { registerCleanup, wizardAbort } from '@utils/wizard-abort';
import { ErrorCodes } from '@shared/errors';
import type { ProgramConfig } from '../program-step';
import { AUDIT_CHECKS_KEY } from '../audit/types';

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
vi.mock('@lib/task-stream/index', () => ({
  TaskStreamPush: class {
    attach = vi.fn();
    finishRun = vi.fn().mockResolvedValue(undefined);
    shutdown = streamShutdown;
  },
  PostHogDestination: class {},
  createFileDestination: () => null,
}));
vi.mock('@ui/tui/start-tui', () => ({ startTUI: vi.fn() }));
vi.mock('@utils/debug');
vi.mock('@utils/analytics', () => ({
  analytics: {
    build: 'test',
    runId: 'run-1',
    wizardCapture: vi.fn(),
    captureException: vi.fn(),
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
vi.mock('@lib/programs/authenticate', () => ({
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

/** A run that reports, shows its outro and succeeds. */
const finishRun: typeof runAgent = (_config, _input, options) => {
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
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authenticate).mockImplementation((sess) => {
    sess.credentials = session().credentials;
    return Promise.resolve();
  });
  setUI(new LoggingUI());
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.mocked(runAgent).mockImplementation(finishRun);
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
    expect(analytics.shutdown).toHaveBeenCalledExactlyOnceWith('success');
  },
);

it('sends terminal analytics after the outro and the run, before the host goes on', async () => {
  const order: string[] = [];
  logSpy.mockImplementation((line) => {
    if (line === '└  Done') order.push('outro');
  });
  vi.mocked(runAgent).mockImplementation(async (...args) => {
    const result = await finishRun(...args);
    order.push('run-returned');
    return result;
  });
  vi.mocked(analytics.shutdown).mockImplementation(() => {
    order.push('shutdown');
    return Promise.resolve();
  });
  await runProgramAgent(program(), session());
  order.push('host-continues');
  expect(order).toEqual([
    'outro',
    'run-returned',
    'shutdown',
    'host-continues',
  ]);
  expect(analytics.shutdown).toHaveBeenCalledExactlyOnceWith('success');
});

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

  // The host program's own run, later in the same process, ends it once.
  await runProgramAgent(program(), session());
  expect(analytics.shutdown).toHaveBeenCalledExactlyOnceWith('success');
});

it.each([
  [RunOutcome.Aborted, 'cancelled'],
  [RunOutcome.Failed, 'error'],
] as const)(
  'passes a %s result to the existing abort handler as %s',
  async (outcome, status) => {
    const failure = {
      code: ErrorCodes.AgentApiError,
      message: 'Failed',
      exitCode: 2,
    };
    vi.mocked(runAgent).mockResolvedValue({ outcome, failure, snapshot });
    await runProgramAgent(program(), session());
    expect(wizardAbort).toHaveBeenCalledExactlyOnceWith({ ...failure, status });
    expect(analytics.shutdown).not.toHaveBeenCalled();
  },
);

it.each([
  [
    RunOutcome.Failed,
    'error',
    { code: ErrorCodes.AgentMcpMissing, message: 'Could not access MCP' },
  ],
  [
    RunOutcome.Aborted,
    'cancelled',
    { code: ErrorCodes.AgentAbort, message: 'Agent run cancelled' },
  ],
] as const)(
  'labels a %s run %s from its outcome when no Error came back',
  async (outcome, status, failure) => {
    const actual = await vi.importActual<typeof import('@utils/wizard-abort')>(
      '@utils/wizard-abort',
    );
    vi.mocked(wizardAbort).mockImplementationOnce(actual.wizardAbort);
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    vi.mocked(runAgent).mockResolvedValue({
      outcome,
      failure: { ...failure },
      snapshot,
    });
    try {
      await runProgramAgent(program(), session());
    } finally {
      exit.mockRestore();
      stderr.mockRestore();
    }
    expect(analytics.shutdown).toHaveBeenCalledExactlyOnceWith(status);
    if (status === 'error') {
      // Error tracking still sees the failure, as its code and message.
      expect(analytics.captureException).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          message: failure.message,
          code: failure.code,
        }),
        { error_code: failure.code },
      );
    } else {
      expect(analytics.captureException).not.toHaveBeenCalled();
    }
  },
);

it('shows the auth guidance from a decided 401 before the error outro', async () => {
  const detail = { hasSettingsConflict: false, logFilePath: '/tmp/wizard.log' };
  const show = vi.spyOn(getUI(), 'showAuthError');
  vi.mocked(runAgent).mockResolvedValue({
    outcome: RunOutcome.Failed,
    failure: {
      code: ErrorCodes.AuthInvalidOrExpired,
      message: 'Authentication failed (401)',
      authErrorDetail: detail,
    },
    snapshot,
  });
  await runProgramAgent(program(), session());
  expect(show).toHaveBeenCalledExactlyOnceWith(detail);
  expect(wizardAbort).toHaveBeenCalledWith(
    expect.objectContaining({ authErrorDetail: detail }),
  );
  // wizardAbort sends the one terminal event for a failed run.
  expect(analytics.shutdown).not.toHaveBeenCalled();
});

it('rethrows the original crash for the outer runner', async () => {
  const error = new Error('mint refused');
  const result: RunResult = {
    outcome: RunOutcome.Crashed,
    failure: {
      code: ErrorCodes.InternalUnhandled,
      message: error.message,
      error,
    },
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
    // One terminal event for the process, sent before the stream settles.
    expect(analytics.shutdown).toHaveBeenCalledExactlyOnceWith('success');
    expect(
      vi.mocked(analytics.shutdown).mock.invocationCallOrder[0],
    ).toBeLessThan(streamShutdown.mock.invocationCallOrder[0]);
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

it('keeps a headless run a success when its terminal analytics flush fails', async () => {
  const flushError = new Error('flush timed out');
  vi.mocked(analytics.shutdown).mockRejectedValueOnce(flushError);
  runNonInteractive(
    program(),
    {
      apiKey: 'phx_test',
      projectId: '1',
      installDir: '/tmp/adapter-test',
      telemetry: false,
    },
    'headless',
  );
  await vi.waitFor(() => expect(streamShutdown).toHaveBeenCalledOnce());
  expect(wizardAbort).not.toHaveBeenCalled();
  expect(analytics.shutdown).toHaveBeenCalledExactlyOnceWith('success');
  expect(logToFile).toHaveBeenCalledWith(
    expect.stringContaining('analytics shutdown failed'),
    flushError,
  );
});

it('keeps a TUI run a success when its terminal analytics flush fails', async () => {
  const flushError = new Error('flush timed out');
  vi.mocked(analytics.shutdown).mockRejectedValueOnce(flushError);
  const store = new WizardStore('metrics');
  const ui = new InkUI(store);
  setUI(ui);
  const outroError = vi.spyOn(ui, 'outroError');
  vi.spyOn(store, 'runReadyHooks').mockResolvedValue(undefined);
  vi.spyOn(store, 'getGate').mockResolvedValue(undefined);
  vi.mocked(startTUI).mockReturnValue({
    store,
    unmount: vi.fn(),
    waitForSetup: () => Promise.resolve(),
  });
  const exit = vi
    .spyOn(process, 'exit')
    .mockImplementation(() => undefined as never);

  runWizard(program(), { installDir: '/tmp/adapter-test', telemetry: false });
  await vi.waitFor(() => expect(analytics.shutdown).toHaveBeenCalled());
  store.setSkillsComplete(true);
  await vi.waitFor(() => expect(exit).toHaveBeenCalled());

  expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  expect(outroError).not.toHaveBeenCalled();
  expect(store.session.outroData?.kind).toBe(OutroKind.Success);
  expect(analytics.shutdown).toHaveBeenCalledExactlyOnceWith('success');
  expect(logToFile).toHaveBeenCalledWith(
    expect.stringContaining('analytics shutdown failed'),
    flushError,
  );
  exit.mockRestore();
});

describe('the audit ledger', () => {
  let installDir: string;
  const ledgerPath = () => path.join(installDir, '.posthog-audit-checks.json');
  const audit = (): ProgramConfig => ({
    ...program(),
    auditLedgerFile: '.posthog-audit-checks.json',
  });
  const auditSession = () => ({ ...session(), installDir });
  /** The agent seeds the ledger and, like a real run, never runs the `rm`. */
  const seedThen =
    (finish: typeof runAgent): typeof runAgent =>
    (...args) => {
      fs.writeFileSync(ledgerPath(), '[]');
      return finish(...args);
    };

  beforeEach(() => {
    installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-ledger-'));
  });
  afterEach(() => fs.rmSync(installDir, { recursive: true, force: true }));

  it('is removed from the project once the run settles', async () => {
    vi.mocked(runAgent).mockImplementation(seedThen(finishRun));
    await runProgramAgent(audit(), auditSession());
    expect(fs.existsSync(ledgerPath())).toBe(false);
  });

  it('is removed when the run throws', async () => {
    const error = new Error('agent crashed');
    vi.mocked(runAgent).mockImplementation(
      seedThen(() => Promise.reject(error)),
    );
    await expect(runProgramAgent(audit(), auditSession())).rejects.toBe(error);
    expect(fs.existsSync(ledgerPath())).toBe(false);
  });

  it('is removed by the abort cleanup', async () => {
    const onAbort: Array<() => void> = [];
    vi.mocked(registerCleanup).mockImplementation((fn) => {
      onAbort.push(fn);
    });
    let leftAfterAbort = true;
    vi.mocked(runAgent).mockImplementation(
      seedThen((...args) => {
        onAbort.forEach((fn) => fn());
        leftAfterAbort = fs.existsSync(ledgerPath());
        return finishRun(...args);
      }),
    );
    await runProgramAgent(audit(), auditSession());
    expect(leftAfterAbort).toBe(false);
  });

  it('keeps a finished run a success when the ledger cannot be removed', async () => {
    vi.mocked(runAgent).mockImplementation((...args) => {
      fs.mkdirSync(ledgerPath());
      return finishRun(...args);
    });
    await expect(
      runProgramAgent(audit(), auditSession()),
    ).resolves.toBeUndefined();
    expect(logToFile).toHaveBeenCalledWith(
      expect.stringContaining('[audit-ledger] could not remove'),
    );
  });

  it('mirrors a last write the watcher has not read yet', async () => {
    const checks = [
      { id: 'sdk', area: 'SDK', label: 'Install the SDK', status: 'pass' },
    ];
    const mirror = vi.spyOn(getUI(), 'setFrameworkContext');
    vi.mocked(runAgent).mockImplementation((...args) => {
      fs.writeFileSync(ledgerPath(), JSON.stringify(checks));
      return finishRun(...args);
    });
    await runProgramAgent(audit(), auditSession());
    expect(mirror).toHaveBeenCalledWith(AUDIT_CHECKS_KEY, checks);
  });
});
