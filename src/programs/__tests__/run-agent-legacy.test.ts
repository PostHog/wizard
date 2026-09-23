import { runNonInteractive } from '@lib/runners/run-non-interactive';
import { runWizard } from '@lib/runners/run-wizard';
import { authenticate } from '@programs/authenticate';
import { runProgramAgent } from '../run-agent-legacy';
import { runAgent, RunOutcome, type RunResult } from '@agent/runner';
import { Harness, Sequence } from '@shared/constants';
import { checkLocalServices } from '@shared/local-dev';
import {
  buildSession,
  DiscoveredFeature,
  OutroKind,
  ScanConsent,
} from '@lib/wizard-session';
import type { ApiUser } from '@shared/api';
import { HostResolution } from '@shared/host-resolution';
import { LoggingUI } from '@ui/logging-ui';
import { InkUI } from '@ui/tui/ink-ui';
import { startTUI } from '@ui/tui/start-tui';
import { WizardStore } from '@ui/tui/store';
import { getUI, setUI } from '@ui';
import { analytics } from '@utils/analytics';
import { initLogFile, logToFile } from '@utils/debug';
import { clearCleanup, runCleanups, wizardAbort } from '@utils/wizard-abort';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ErrorCodes } from '@shared/errors';
import type { ProgramConfig } from '../program-step';

const streamShutdown = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
let headlessStore: WizardStore | undefined;
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
    constructor(options: { store: WizardStore }) {
      headlessStore = options.store;
    }
    attach = vi.fn();
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
vi.mock('@programs/authenticate', () => ({
  authenticate: vi.fn().mockResolvedValue(undefined),
  refreshAccessTokenIfNeeded: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@shared/claude-settings', () => ({
  checkAllSettingsConflicts: vi.fn().mockReturnValue([]),
  restoreClaudeSettings: vi.fn(),
}));
// Fixture ids such as `metrics` are health-check programs, so preflight probes readiness.
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
vi.mock('@utils/wizard-abort', async (original) => {
  const actual = await original<typeof import('@utils/wizard-abort')>();
  return {
    ...actual,
    wizardAbort: vi.fn().mockResolvedValue(undefined),
  };
});
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
  headlessStore = undefined;
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

it('passes a session-scoped CI bearer to a composed child run', async () => {
  const inferenceAuth = {
    resolve: vi.fn().mockResolvedValue({
      gatewayUrl: 'https://ai-gateway.us.posthog.com',
      token: 'fixed-ci-bearer',
      teamId: 42,
      refreshAtMs: Infinity,
    }),
  };
  const scopedSession = Object.assign(session(), { inferenceAuth });

  await runProgramAgent(program(), scopedSession, { composed: true });

  expect(vi.mocked(runAgent).mock.calls[0]?.[1].inferenceAuth).toBe(
    inferenceAuth,
  );
});

it('hands the session stamp latch to runProgram, so the organization is stamped once', async () => {
  const stamped = Object.assign(session(), {
    apiUser: { organization: { id: 'org-1' } } as ApiUser,
    scanConsent: ScanConsent.Granted,
    discoveredFeatures: [DiscoveredFeature.LLM],
    // maybeStampAiSdkDetected (mocked here) leaves the latch set.
    aiSdkStampReported: true,
  });

  await runProgramAgent(program(), stamped);

  expect(runAgent).toHaveBeenCalledOnce();
  expect(analytics.groupIdentify).not.toHaveBeenCalled();
});

it('passes the fixed CI bearer through the callable host without agent-global gateway state', async () => {
  const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-ci-auth-'));
  const tokenFile = path.join(installDir, 'gateway-token');
  fs.writeFileSync(tokenFile, ' fixed-ci-bearer \n');
  vi.stubEnv('WIZARD_CI_GATEWAY_TOKEN_FILE', tokenFile);
  try {
    const ciPreRun = vi.fn(async (session: ReturnType<typeof buildSession>) => {
      expect(await session.inferenceAuth?.resolve()).toMatchObject({
        token: 'fixed-ci-bearer',
      });
    });
    runNonInteractive(
      { ...program(), ciPreRun },
      { apiKey: 'phx_test', projectId: '42', installDir, telemetry: false },
      'ci',
    );
    await vi.waitFor(() => expect(streamShutdown).toHaveBeenCalledOnce());
    expect(ciPreRun).toHaveBeenCalledOnce();
    // One terminal event for the process, sent before the stream settles.
    expect(analytics.shutdown).toHaveBeenCalledExactlyOnceWith('success');
    expect(
      vi.mocked(analytics.shutdown).mock.invocationCallOrder[0],
    ).toBeLessThan(streamShutdown.mock.invocationCallOrder[0]);

    expect(headlessStore?.session.inferenceAuth).toBeDefined();
    expect(await headlessStore?.session.inferenceAuth?.resolve()).toMatchObject(
      {
        token: 'fixed-ci-bearer',
      },
    );

    const input = vi.mocked(runAgent).mock.calls[0]?.[1];
    expect(input).toBeDefined();
    expect(await input?.inferenceAuth?.resolve()).toEqual({
      token: 'fixed-ci-bearer',
      teamId: 42,
      gatewayUrl: 'https://ai-gateway.us.posthog.com',
      refreshAtMs: Infinity,
    });
    expect(process.env.WIZARD_CI_GATEWAY_TOKEN_FILE).toBeUndefined();
  } finally {
    vi.unstubAllEnvs();
    fs.rmSync(installDir, { recursive: true, force: true });
  }
});

it('cleans new Wizard skills when non-interactive startup crashes before the agent', async () => {
  const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-ci-crash-'));
  const skillDir = path.join(
    installDir,
    '.claude',
    'skills',
    'startup-install',
  );
  const exit = vi
    .spyOn(process, 'exit')
    .mockImplementation(() => undefined as never);
  vi.mocked(checkLocalServices).mockImplementationOnce(() => {
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, '.posthog-wizard'), '');
    return Promise.reject(new Error('startup crashed'));
  });
  try {
    runNonInteractive(
      program(),
      { apiKey: 'phx_test', projectId: '1', installDir, telemetry: false },
      'ci',
    );
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(fs.existsSync(skillDir)).toBe(false);
    expect(runAgent).not.toHaveBeenCalled();
  } finally {
    exit.mockRestore();
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

it('registers cleanup before the agent starts so a signal removes only new marked skills', async () => {
  const installDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'wizard-run-cleanup-'),
  );
  const skillsDir = path.join(installDir, '.claude', 'skills');
  const makeSkill = (id: string, marked: boolean) => {
    const dir = path.join(skillsDir, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '# skill');
    if (marked) fs.writeFileSync(path.join(dir, '.posthog-wizard'), '');
  };
  try {
    makeSkill('preexisting', true);
    vi.mocked(runAgent).mockImplementationOnce(() => {
      makeSkill('installed-this-run', true);
      makeSkill('user-owned-this-run', false);
      // runWizard's SIGINT/SIGTERM handler calls the registered cleanups.
      runCleanups();
      return Promise.resolve({ outcome: RunOutcome.Success, snapshot });
    });

    await runProgramAgent(program(), { ...session(), installDir });

    expect(fs.readdirSync(skillsDir).sort()).toEqual([
      'preexisting',
      'user-owned-this-run',
    ]);
  } finally {
    fs.rmSync(installDir, { recursive: true, force: true });
  }
});

it('disarms registered skill cleanup after a successful standalone program run', async () => {
  const installDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'wizard-run-complete-'),
  );
  const skillDir = path.join(installDir, '.claude', 'skills', 'installed');
  vi.mocked(runAgent).mockImplementationOnce(() => {
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, '.posthog-wizard'), '');
    return Promise.resolve({ outcome: RunOutcome.Success, snapshot });
  });
  try {
    await runProgramAgent(program(), { ...session(), installDir });
    runCleanups();
    expect(fs.existsSync(skillDir)).toBe(true);
  } finally {
    fs.rmSync(installDir, { recursive: true, force: true });
  }
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

it('keeps new Wizard skills after headless stream settlement succeeds', async () => {
  const installDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'wizard-headless-success-'),
  );
  const skillDir = path.join(installDir, '.claude', 'skills', 'completed');
  vi.mocked(runAgent).mockImplementationOnce(() => {
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, '.posthog-wizard'), '');
    return Promise.resolve({ outcome: RunOutcome.Success, snapshot });
  });
  try {
    runNonInteractive(
      program(),
      { apiKey: 'phx_test', projectId: '1', installDir, telemetry: false },
      'headless',
    );
    await vi.waitFor(() => expect(streamShutdown).toHaveBeenCalledOnce());
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(analytics.shutdown).toHaveBeenCalledExactlyOnceWith('success');
    runCleanups();
    expect(fs.existsSync(skillDir)).toBe(true);
  } finally {
    fs.rmSync(installDir, { recursive: true, force: true });
  }
});

it('cleans a marked install when program setup throws before the functional runner', async () => {
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
  try {
    await expect(
      runProgramAgent(failingProgram, { ...session(), installDir }),
    ).rejects.toBe(setupFailure);
    expect(fs.existsSync(skillDir)).toBe(false);
    expect(runAgent).not.toHaveBeenCalled();
  } finally {
    fs.rmSync(installDir, { recursive: true, force: true });
  }
});

it.each([
  ['SIGINT', 130],
  ['SIGTERM', 143],
] as const)(
  'cleans new Wizard skills on non-interactive %s before the agent starts',
  async (signal, exitCode) => {
    const installDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'wizard-ci-signal-'),
    );
    const skillsDir = path.join(installDir, '.claude', 'skills');
    const tokenFile = path.join(installDir, 'gateway-token');
    fs.writeFileSync(tokenFile, 'fixed-ci-bearer');
    vi.stubEnv('WIZARD_CI_GATEWAY_TOKEN_FILE', tokenFile);
    const makeSkill = (id: string, marked: boolean) => {
      const dir = path.join(skillsDir, id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), '# skill');
      if (marked) fs.writeFileSync(path.join(dir, '.posthog-wizard'), '');
    };
    makeSkill('preexisting', true);
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
    const signalProgram = program();
    signalProgram.ciPreRun = () => {
      makeSkill('installed-before-agent', true);
      makeSkill('user-owned-before-agent', false);
      process.emit(signal);
      return Promise.resolve();
    };
    try {
      runNonInteractive(
        signalProgram,
        { apiKey: 'phx_test', projectId: '1', installDir, telemetry: false },
        'ci',
      );
      await vi.waitFor(() => expect(streamShutdown).toHaveBeenCalledOnce());
      expect(exit).toHaveBeenCalledWith(exitCode);
      expect(fs.readdirSync(skillsDir).sort()).toEqual([
        'preexisting',
        'user-owned-before-agent',
      ]);
    } finally {
      exit.mockRestore();
      vi.unstubAllEnvs();
      fs.rmSync(installDir, { recursive: true, force: true });
    }
  },
);

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
