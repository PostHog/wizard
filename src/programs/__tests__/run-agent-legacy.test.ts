import { runNonInteractive } from '@lib/runners/run-non-interactive';
import { authenticate } from '@programs/authenticate';
import { runProgramAgent } from '../run-agent-legacy';
import { runAgent, RunOutcome, type RunResult } from '@agent/runner';
import { Harness, Sequence } from '@shared/constants';
import { checkLocalServices } from '@shared/local-dev';
import { buildSession, OutroKind } from '@lib/wizard-session';
import { HostResolution } from '@shared/host-resolution';
import { LoggingUI } from '@ui/logging-ui';
import { setUI } from '@ui';
import { analytics } from '@utils/analytics';
import { initLogFile } from '@utils/debug';
import {
  clearCleanup,
  registerCleanup,
  wizardAbort,
} from '@utils/wizard-abort';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ProgramConfig } from '../program-step';
import type { WizardStore } from '@ui/tui/store';

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
vi.mock('@utils/wizard-abort', async (original) => {
  const actual = await original<typeof import('@utils/wizard-abort')>();
  return {
    ...actual,
    registerCleanup: vi.fn(actual.registerCleanup),
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
      for (const [cleanup] of vi.mocked(registerCleanup).mock.calls) cleanup();
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
