import { runNonInteractive } from '@cli/runners/run-non-interactive';
import { runWizard } from '@cli/runners/run-wizard';
import { authenticate } from '@programs/authenticate';
import { runProgramAgent } from '@cli/runners/run-program-agent';
import { runAgent, RunOutcome, type RunResult } from '@agent/runner';
import { Harness, Sequence } from '@shared/constants';
import { buildSession } from '@tui/session';
import { OutroKind } from '@shared/outro';
import { DiscoveredFeature, ScanConsent } from '@shared/scan-consent';
import type { ApiUser } from '@shared/api';
import { HostResolution } from '@shared/host-resolution';
import { LoggingUI } from '@headless/renderers/logging-ui';
import { InkUI } from '@tui/ink-ui';
import * as ledgerWatch from '../audit/watch-ledger';
import { auditConfig } from '../audit/index';
import { AUDIT_SEED_CHECKS } from '../audit/seed';
import { AUDIT_CHECKS_FILE, AUDIT_CHECKS_KEY } from '../audit/types';
import { EVENT_PLAN_FILE } from '../posthog-integration/constants';
import { startTUI } from '@tui/start-tui';
import { WizardStore } from '@tui/store';
import { getUI, setUI } from '@cli/ui';
import { analytics } from '@utils/analytics';
import { initLogFile, logToFile } from '@utils/debug';
import { clearCleanup, runCleanups } from '@utils/cleanup-registry';
import { wizardAbort } from '@cli/wizard-abort';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ErrorCodes } from '@shared/errors';
import {
  checkAllSettingsConflicts,
  restoreClaudeSettings,
} from '@shared/claude-settings';
import { refreshAccessToken } from '@utils/oauth-token';
import { evaluateWizardReadiness } from '@shared/health-checks/readiness';
import { errorTrackingUploadSourceMapsConfig } from '../error-tracking-upload-source-maps/index';
import type { ProgramConfig } from '../program-step';
import type { ProgramRun } from '../program-run';

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
vi.mock('@programs/task-stream/index', () => ({
  TaskStreamPush: class {
    attach = vi.fn();
    shutdown = streamShutdown;
  },
  PostHogDestination: class {},
  createFileDestination: () => null,
}));
vi.mock('@tui/start-tui', () => ({ startTUI: vi.fn() }));
vi.mock('@utils/debug');
vi.mock('@utils/analytics', () => ({
  analytics: {
    build: 'test',
    runId: 'run-1',
    wizardCapture: vi.fn(),
    captureException: vi.fn(),
    setTag: vi.fn(),
    identifyUser: vi.fn(),
    setGroups: vi.fn(),
    groupIdentify: vi.fn(),
    getAllFlagsForWizard: vi.fn().mockResolvedValue({}),
    getWizardFlagPayloads: vi.fn().mockReturnValue({}),
    shutdown: vi.fn().mockResolvedValue(undefined),
  },
  groupsFromUser: () => ({}),
  sessionProperties: () => ({}),
}));
vi.mock('@agent/runner', async (original) => ({
  ...(await original<typeof import('@agent/runner')>()),
  runAgent: vi.fn(),
}));
vi.mock('@programs/authenticate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@programs/authenticate')>()),
  authenticate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@shared/claude-settings', () => ({
  checkAllSettingsConflicts: vi.fn().mockReturnValue([]),
  restoreClaudeSettings: vi.fn(),
}));
// Fixture ids such as `metrics` have a health-check step in their TUI flow, so
// the health gate probes readiness.
vi.mock('@shared/health-checks/readiness', async (original) => {
  const actual = await original<
    typeof import('@shared/health-checks/readiness')
  >();
  return {
    ...actual,
    evaluateWizardReadiness: vi.fn().mockResolvedValue({
      decision: actual.WizardReadiness.Yes,
      health: {},
      reasons: [],
    }),
  };
});
vi.mock('@cli/wizard-abort', async (original) => ({
  ...(await original<typeof import('@cli/wizard-abort')>()),
  wizardAbort: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../posthog-integration/detect', () => ({
  maybeStampAiSdkDetected: vi.fn(),
}));
vi.mock('@utils/oauth-token', () => ({ refreshAccessToken: vi.fn() }));

const program = (id: ProgramConfig['id'] = 'metrics'): ProgramConfig => ({
  id,
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
  clearCleanup();
  vi.clearAllMocks();
  vi.mocked(authenticate).mockImplementation((sess) => {
    sess.credentials = session().credentials;
    return Promise.resolve();
  });
  setUI(new LoggingUI());
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.mocked(runAgent).mockImplementation(finishRun);
});
afterEach(() => {
  clearCleanup();
  logSpy.mockRestore();
});

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

it('probes readiness only when the program flow has a health-check step', async () => {
  await runProgramAgent(program('metrics'), session());
  expect(evaluateWizardReadiness).toHaveBeenCalledOnce();

  vi.mocked(evaluateWizardReadiness).mockClear();
  await runProgramAgent(program('warehouse-source'), session());
  expect(evaluateWizardReadiness).not.toHaveBeenCalled();
});

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

it('reports info, warnings and spinners through the current UI', async () => {
  const ui = new LoggingUI();
  const spinner = { start: vi.fn(), stop: vi.fn(), message: vi.fn() };
  vi.spyOn(ui.log, 'info');
  vi.spyOn(ui.log, 'warn');
  vi.spyOn(ui, 'spinner').mockReturnValue(spinner);
  setUI(ui);
  const config = program();
  config.run = (_session, host) => {
    host.info('Uploading environment variables to Vercel...');
    host.warn('careful');
    expect(host.spinner()).toBe(spinner);
    return Promise.resolve(program().run as ProgramRun);
  };

  await runProgramAgent(config, session());

  expect(ui.log.info).toHaveBeenCalledWith(
    'Uploading environment variables to Vercel...',
  );
  expect(ui.log.warn).toHaveBeenCalledWith('careful');
});

it('reads completion data when each hook runs, after late URL updates', async () => {
  const currentSession = session();
  const postRun = vi.fn().mockResolvedValue(undefined);
  const buildOutroData = vi.fn().mockReturnValue({
    kind: OutroKind.Success,
    message: 'Done',
  });
  const buildOutroNextSteps = vi.fn().mockReturnValue(undefined);
  const config = program();
  config.run = {
    ...(config.run as ProgramRun),
    postRun,
    buildOutroData,
    buildOutroNextSteps,
  };
  vi.mocked(runAgent).mockImplementationOnce(async (runConfig, input) => {
    currentSession.dashboardUrl = 'https://us.posthog.com/dashboard/42';
    await runConfig.hooks?.postRun?.(input.credentials);
    currentSession.notebookUrl = 'https://us.posthog.com/notebook/7';
    runConfig.hooks?.buildOutroData?.(input.credentials);
    runConfig.hooks?.buildOutroNextSteps?.(input.credentials, ['seeded']);
    return { outcome: RunOutcome.Success, snapshot };
  });

  await runProgramAgent(config, currentSession);

  expect(postRun).toHaveBeenCalledWith(
    {
      signup: false,
      dashboardUrl: 'https://us.posthog.com/dashboard/42',
      notebookUrl: null,
    },
    currentSession.credentials,
  );
  expect(buildOutroData).toHaveBeenCalledWith(
    {
      signup: false,
      dashboardUrl: 'https://us.posthog.com/dashboard/42',
      notebookUrl: 'https://us.posthog.com/notebook/7',
    },
    currentSession.credentials,
  );
  expect(buildOutroNextSteps).toHaveBeenCalledWith(
    {
      signup: false,
      dashboardUrl: 'https://us.posthog.com/dashboard/42',
      notebookUrl: 'https://us.posthog.com/notebook/7',
    },
    currentSession.credentials,
    ['seeded'],
  );
});

it('projects an audit ledger update from program data through the legacy runner UI bridge', async () => {
  const installDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'wizard-audit-bridge-'),
  );
  const currentSession = session();
  currentSession.installDir = installDir;
  const config = program('audit');
  config.auditLedgerFile = AUDIT_CHECKS_FILE;
  config.auditSeedChecks = AUDIT_SEED_CHECKS;
  const ui = new LoggingUI();
  const setFrameworkContext = vi.spyOn(ui, 'setFrameworkContext');
  setUI(ui);
  const watchLedger = vi.spyOn(ledgerWatch, 'watchAuditLedger');
  const checksSent = () =>
    setFrameworkContext.mock.calls.filter(([key]) => key === AUDIT_CHECKS_KEY);
  const checks = [{ id: 'new', area: 'Events', label: 'new', status: 'pass' }];
  vi.mocked(runAgent).mockImplementationOnce(async () => {
    fs.writeFileSync(
      path.join(installDir, AUDIT_CHECKS_FILE),
      JSON.stringify(checks),
    );
    // The update reaches the UI while the agent still runs.
    await vi.waitFor(
      () =>
        expect(setFrameworkContext).toHaveBeenCalledWith(
          AUDIT_CHECKS_KEY,
          checks,
        ),
      { timeout: 7000 },
    );
    return { outcome: RunOutcome.Success, snapshot };
  });
  try {
    await runProgramAgent(config, currentSession);
    // runProgram's watcher is the only one; the projection forwards each value once.
    expect(watchLedger).toHaveBeenCalledOnce();
    expect(checksSent()).toEqual([
      [AUDIT_CHECKS_KEY, AUDIT_SEED_CHECKS],
      [AUDIT_CHECKS_KEY, checks],
    ]);
  } finally {
    watchLedger.mockRestore();
    fs.rmSync(installDir, { recursive: true, force: true });
  }
}, 8000);

it('hands the CI bearer from the token file to ciPreRun and the agent through the session', async () => {
  const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-ci-auth-'));
  const tokenFile = path.join(installDir, 'gateway-token');
  fs.writeFileSync(tokenFile, 'fixed-ci-bearer');
  vi.stubEnv('WIZARD_CI_GATEWAY_TOKEN_FILE', tokenFile);
  try {
    const ciPreRun = vi.fn((_session: ReturnType<typeof buildSession>) =>
      Promise.resolve(),
    );
    runNonInteractive(
      { ...program(), ciPreRun },
      { apiKey: 'phx_test', projectId: '42', installDir, telemetry: false },
      'ci',
    );
    await vi.waitFor(() => expect(streamShutdown).toHaveBeenCalledOnce());
    const provider = ciPreRun.mock.calls[0]?.[0].inferenceAuth;
    expect(provider).toBeDefined();
    expect(vi.mocked(runAgent).mock.calls[0]?.[1].inferenceAuth).toBe(provider);
  } finally {
    vi.unstubAllEnvs();
    fs.rmSync(installDir, { recursive: true, force: true });
  }
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
    const actual = await vi.importActual<typeof import('@cli/wizard-abort')>(
      '@cli/wizard-abort',
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

it.each(['ci', 'headless'] as const)(
  'removes new Wizard skills when %s stream settlement fails after agent success',
  async (mode) => {
    const installDir = fs.mkdtempSync(
      path.join(os.tmpdir(), `wizard-${mode}-late-failure-`),
    );
    const skillDir = path.join(installDir, '.claude', 'skills', 'unfinished');
    const tokenFile = path.join(installDir, 'gateway-token');
    fs.writeFileSync(tokenFile, 'fixed-ci-bearer');
    vi.stubEnv('WIZARD_CI_GATEWAY_TOKEN_FILE', tokenFile);
    const settlementError = new Error('task stream failed to flush');
    streamShutdown.mockRejectedValueOnce(settlementError);
    vi.mocked(wizardAbort).mockImplementationOnce(() => {
      runCleanups();
      return Promise.resolve(undefined as never);
    });
    vi.mocked(runAgent).mockImplementationOnce(() => {
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, '.posthog-wizard'), '');
      return Promise.resolve({ outcome: RunOutcome.Success, snapshot });
    });

    try {
      runNonInteractive(
        program(),
        { apiKey: 'phx_test', projectId: '1', installDir, telemetry: false },
        mode,
      );
      await vi.waitFor(() => expect(wizardAbort).toHaveBeenCalledOnce());
      expect(wizardAbort).toHaveBeenCalledWith(
        expect.objectContaining({ error: settlementError }),
      );
      // The agent run succeeded first, so 'success' goes out before wizardAbort's 'error'.
      expect(analytics.shutdown).toHaveBeenCalledExactlyOnceWith('success');
      expect(
        vi.mocked(analytics.shutdown).mock.invocationCallOrder[0],
      ).toBeLessThan(vi.mocked(wizardAbort).mock.invocationCallOrder[0]);
      expect(streamShutdown).toHaveBeenCalledTimes(2);
      expect(fs.existsSync(skillDir)).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(installDir, { recursive: true, force: true });
    }
  },
);

it("cleans a marked install when program setup throws before the functional runner, through the CLI root's drain", async () => {
  const installDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'wizard-setup-cleanup-'),
  );
  const skillDir = path.join(installDir, '.claude', 'skills', 'setup-install');
  const setupFailure = new Error('program setup failed');
  const failingProgram = program();
  failingProgram.run = () => {
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, '.posthog-wizard'), '');
    throw setupFailure;
  };
  const actual = await vi.importActual<typeof import('@cli/wizard-abort')>(
    '@cli/wizard-abort',
  );
  vi.mocked(wizardAbort).mockImplementationOnce(actual.wizardAbort);
  const exit = vi
    .spyOn(process, 'exit')
    .mockImplementation(() => undefined as never);
  const stderr = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(() => true);
  try {
    runNonInteractive(
      failingProgram,
      { apiKey: 'phx_test', projectId: '1', installDir, telemetry: false },
      'headless',
    );
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    expect(wizardAbort).toHaveBeenCalledWith(
      expect.objectContaining({ error: setupFailure }),
    );
    expect(fs.existsSync(skillDir)).toBe(false);
    expect(runAgent).not.toHaveBeenCalled();
  } finally {
    exit.mockRestore();
    stderr.mockRestore();
    fs.rmSync(installDir, { recursive: true, force: true });
  }
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

it.each([
  ['SIGINT', [[130]], false],
  ['SIGTERM', [[143]], false],
  ['completion', [], true],
] as const)(
  'a headless run ended by %s exits %j and keeps its new skill: %s',
  async (ending, exits, kept) => {
    const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-ci-'));
    const skillDir = path.join(installDir, '.claude', 'skills', 'installed');
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
    const config: ProgramConfig = {
      ...program(),
      ciPreRun: () => {
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(path.join(skillDir, '.posthog-wizard'), '');
        if (ending !== 'completion') process.emit(ending);
        return Promise.resolve();
      },
    };
    try {
      runNonInteractive(
        config,
        { apiKey: 'phx_test', projectId: '1', installDir, telemetry: false },
        'headless',
      );
      await vi.waitFor(() => expect(streamShutdown).toHaveBeenCalledOnce());
      await new Promise<void>((resolve) => setImmediate(resolve));
      runCleanups();

      expect(exit.mock.calls).toEqual(exits);
      expect(fs.existsSync(skillDir)).toBe(kept);
    } finally {
      exit.mockRestore();
      fs.rmSync(installDir, { recursive: true, force: true });
    }
  },
);

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

describe('host wiring over runProgram', () => {
  const approved = {
    organization: { id: 'org-1', is_ai_data_processing_approved: true },
  } as ApiUser;

  it('authenticates through the provider after the settings gate, then awaits AI opt-in and the post-auth gate', async () => {
    const order: string[] = [];
    const ui = getUI();
    const record =
      <T>(name: string, value?: T) =>
      () => {
        order.push(name);
        return value as T;
      };
    vi.mocked(checkAllSettingsConflicts).mockImplementationOnce(
      record('settings check', []),
    );
    vi.mocked(authenticate).mockImplementationOnce(
      record('authenticate', Promise.resolve()),
    );
    vi.spyOn(ui, 'waitForAiOptIn').mockImplementation(
      record('waitForAiOptIn', Promise.resolve()),
    );
    vi.spyOn(ui, 'waitForGate').mockImplementation((id) =>
      record(`waitForGate:${id}`, Promise.resolve())(),
    );
    vi.mocked(analytics.getAllFlagsForWizard).mockImplementationOnce(
      record('getAllFlagsForWizard', Promise.resolve({})),
    );
    vi.mocked(runAgent).mockImplementationOnce((...args) => {
      order.push('runAgent');
      return finishRun(...args);
    });

    await runProgramAgent(errorTrackingUploadSourceMapsConfig, {
      ...buildSession({ ci: false, installDir: '/tmp/adapter-test' }),
      credentials: session().credentials,
      apiUser: { organization: { is_ai_data_processing_approved: false } },
    } as ReturnType<typeof session>);

    expect(order).toEqual([
      'settings check',
      'authenticate',
      'waitForAiOptIn',
      'waitForGate:detect',
      'getAllFlagsForWizard',
      'runAgent',
    ]);
  });

  it('a refreshed token reaches session and UI', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValueOnce({
      access_token: 'pha_new',
      refresh_token: 'phr_rotated',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'project:read',
    });
    // authenticate is a no-op for a session that already has its login.
    vi.mocked(authenticate).mockImplementationOnce(() => Promise.resolve());
    const aging = {
      ...session().credentials,
      refreshToken: 'phr_old',
      expiresAt: Date.now() + 20 * 60 * 1000,
      projectId: 7,
    };
    const refreshing = { ...session(), credentials: aging };
    const setAccessToken = vi.spyOn(getUI(), 'setAccessToken');

    await runProgramAgent(program(), refreshing);

    expect(refreshing.credentials).toMatchObject({
      accessToken: 'pha_new',
      refreshToken: 'phr_rotated',
      projectId: 7,
    });
    // The login's host keeps its class, not a structured copy.
    expect(refreshing.credentials.host).toBe(aging.host);
    expect(aging.accessToken).toBe('test');
    expect(setAccessToken).toHaveBeenCalledExactlyOnceWith(
      refreshing.credentials,
    );
  });

  it.each([
    [false, 1],
    [true, 0],
  ])(
    'passes the session stamp latch (%s) to runProgram and latches the session',
    async (latched, stamps) => {
      const stamping = Object.assign(session(), {
        apiUser: approved,
        scanConsent: ScanConsent.Granted,
        discoveredFeatures: [DiscoveredFeature.LLM],
        aiSdkStampReported: latched,
      });

      await runProgramAgent(program(), stamping);

      expect(analytics.groupIdentify).toHaveBeenCalledTimes(stamps);
      expect(stamping.aiSdkStampReported).toBe(true);
    },
  );

  it('registers the linear settings restore once, before the run can reach the outro', async () => {
    const onEnterScreen = vi.spyOn(getUI(), 'onEnterScreen');
    let registeredBeforeRun = false;
    vi.mocked(runAgent).mockImplementationOnce((...args) => {
      registeredBeforeRun = onEnterScreen.mock.calls.length === 1;
      return finishRun(...args);
    });

    // A composed program is clamped to linear.
    await runProgramAgent(program(), session(), { composed: true });

    expect(registeredBeforeRun).toBe(true);
    expect(onEnterScreen).toHaveBeenCalledExactlyOnceWith(
      'outro',
      expect.any(Function),
    );
    onEnterScreen.mock.calls[0][1]();
    expect(restoreClaudeSettings).toHaveBeenCalledExactlyOnceWith(
      '/tmp/adapter-test',
    );

    onEnterScreen.mockClear();
    await runProgramAgent(program(), session());
    expect(onEnterScreen).not.toHaveBeenCalled();
  });

  describe('program files', () => {
    let installDir: string;
    beforeEach(() => {
      installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-files-'));
    });
    afterEach(() => {
      fs.rmSync(installDir, { recursive: true, force: true });
    });

    it('sends the host the seeded audit checks before the run, then each update once', async () => {
      const setFrameworkContext = vi.spyOn(getUI(), 'setFrameworkContext');
      const sent = () =>
        setFrameworkContext.mock.calls.filter(
          ([key]) => key === AUDIT_CHECKS_KEY,
        );
      const resolved = [{ ...AUDIT_SEED_CHECKS[0], status: 'pass' }];
      let sentBeforeRun: unknown[][] = [];
      vi.mocked(runAgent).mockImplementationOnce((...args) => {
        sentBeforeRun = sent();
        fs.writeFileSync(
          path.join(installDir, AUDIT_CHECKS_FILE),
          JSON.stringify(resolved),
        );
        return finishRun(...args);
      });

      await runProgramAgent(auditConfig, { ...session(), installDir });

      expect(sentBeforeRun).toEqual([[AUDIT_CHECKS_KEY, AUDIT_SEED_CHECKS]]);
      expect(sent()).toEqual([
        [AUDIT_CHECKS_KEY, AUDIT_SEED_CHECKS],
        [AUDIT_CHECKS_KEY, resolved],
      ]);
    });

    it('sends the host the event plan an integration run wrote', async () => {
      const setEventPlan = vi.spyOn(getUI(), 'setEventPlan');
      vi.mocked(runAgent).mockImplementationOnce((...args) => {
        fs.writeFileSync(
          path.join(installDir, EVENT_PLAN_FILE),
          JSON.stringify([{ event_name: 'checkout_started' }]),
        );
        return finishRun(...args);
      });

      await runProgramAgent(
        { ...program('posthog-integration'), eventPlanFile: EVENT_PLAN_FILE },
        { ...session(), installDir },
      );

      expect(setEventPlan).toHaveBeenCalledExactlyOnceWith([
        { name: 'checkout_started', description: '' },
      ]);
    });
  });

  const hostFailure = new Error('host capability failed');
  it.each([
    [
      'a failed login',
      () => vi.mocked(authenticate).mockRejectedValueOnce(hostFailure),
    ],
    [
      'a malformed flag override',
      () =>
        vi
          .mocked(analytics.getAllFlagsForWizard)
          .mockRejectedValueOnce(hostFailure),
    ],
  ])('rethrows %s for the CLI root, as before', async (_name, arrange) => {
    arrange();

    await expect(runProgramAgent(program(), session())).rejects.toBe(
      hostFailure,
    );
    expect(runAgent).not.toHaveBeenCalled();
    expect(wizardAbort).not.toHaveBeenCalled();
  });
});
