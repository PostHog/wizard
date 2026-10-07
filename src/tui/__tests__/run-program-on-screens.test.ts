/** The TUI's run step over a stubbed runProgram: the screens answer its steps, the outcome becomes the exit. */
import type { AgentProgress } from '@agent/types';
import type { ApiUser } from '@shared/api';
import type {
  ProgramConfig,
  ProgramOptions,
  ProgramRunOutcome,
} from '@programs/types';
import { ErrorCodes } from '@shared/errors';
import { WizardReadiness } from '@shared/health-checks/readiness';
import { HostResolution } from '@shared/host-resolution';
import { OutroKind } from '@shared/outro';
import { resetOAuthSession } from '@shared/oauth-session';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import { wizardAbort } from '@host/wizard-abort';
import { runProgramOnScreens } from '../run';
import { buildSession, RunOutcome, runProgram } from '@programs';
import { WizardStore } from '../store';

vi.mock(import('@programs'), async (original) => ({
  ...(await original()),
  runProgram: vi.fn(),
}));
vi.mock(import('@utils/debug'));
vi.mock(import('@utils/analytics'), () => ({
  analytics: {
    build: 'test',
    wizardCapture: vi.fn(),
    captureException: vi.fn(),
    setTag: vi.fn(),
    identifyUser: vi.fn(),
    setGroups: vi.fn(),
    groupIdentify: vi.fn(),
    getAllFlagsForWizard: vi.fn().mockResolvedValue({}),
    getWizardFlagPayloads: vi.fn().mockReturnValue({}),
    shutdown: vi.fn().mockResolvedValue(undefined),
  } as never,
  groupsFromUser: () => ({}),
  sessionProperties: () => ({}),
}));
vi.mock(import('@host/wizard-abort'), async (original) => ({
  ...(await original()),
  wizardAbort: vi.fn().mockResolvedValue(undefined),
}));

const program = (): ProgramConfig => ({
  id: 'metrics',
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
/** What runProgram resolves with. */
const settled = (
  outcome: RunOutcome,
  failure?: ProgramRunOutcome['failure'],
): ProgramRunOutcome => ({
  programId: 'metrics',
  outcome,
  runResults: [],
  artifacts: {},
  failure,
  diagnostics: [],
});
const signal = new AbortController().signal;
/** The capabilities the TUI hands runProgram: it always passes both. */
function capabilities(options: ProgramOptions | undefined) {
  const { credentials: login, workflow } = options ?? {};
  if (!login || !workflow) throw new Error('expected a login and a workflow');
  return { login, workflow };
}
const progress =
  (options: ProgramOptions | undefined) => (event: AgentProgress) =>
    options?.onProgress?.({ runId: 'run-1', event });
const credentials = {
  resolve: () =>
    Promise.resolve({
      posthog: {
        accessToken: 'pha_test',
        projectApiKey: 'phc_test',
        projectId: 1,
        host: HostResolution.fromApiHost('https://us.posthog.com'),
      },
      project: null,
      apiUser: {
        organization: { is_ai_data_processing_approved: true },
      } as ApiUser,
    }),
};

/** The TUI past its intro and health check, as the host calls runProgram. */
function screens() {
  const store = new WizardStore('metrics');
  store.session = buildSession({ installDir: '/tmp/screens-test' });
  store.completeSetup();
  store.setReadinessResult({
    decision: WizardReadiness.Yes,
    health: {} as never,
    reasons: [],
  });
  return { store };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetOAuthSession();
  // As runProgram runs: the login into the store, its run step on the host's
  // screens, the agent's progress, then a settled store (run-program.test.ts).
  vi.mocked(runProgram).mockImplementation(
    async (programId, { store }, options) => {
      const { login, workflow } = capabilities(options);
      store.setLogin(await login.resolve(programId, { signal }));
      await workflow.confirmStep(
        {
          kind: 'run',
          stepId: 'run',
          programId,
        },
        { signal },
      );
      const emit = progress(options);
      emit({ kind: 'lifecycle', phase: 'started' });
      emit({ kind: 'log', level: 'info', message: 'Reading' });
      emit({ kind: 'lifecycle', phase: 'completed', message: 'Done' });
      store.setOutroData({ kind: OutroKind.Success, message: 'Done' });
      return settled(RunOutcome.Success);
    },
  );
});

it('runs once the screens before the run settle, shows its lines, and sends one success event', async () => {
  const { store } = screens();
  await runProgramOnScreens(program(), store, { credentials });
  expect(runProgram).toHaveBeenCalledOnce();
  expect(store.statusMessages).toEqual(['Reading', 'Done']);
  expect(store.session.outroData?.kind).toBe(OutroKind.Success);
  expect(wizardAbort).not.toHaveBeenCalled();
  expect(analytics.shutdown).toHaveBeenCalledExactlyOnceWith('success');
});

it('keeps a run a success when its terminal analytics flush fails', async () => {
  const flushError = new Error('flush timed out');
  vi.mocked(analytics.shutdown).mockRejectedValueOnce(flushError);
  const { store } = screens();
  await runProgramOnScreens(program(), store, { credentials });
  expect(wizardAbort).not.toHaveBeenCalled();
  expect(store.session.outroData?.kind).toBe(OutroKind.Success);
  expect(logToFile).toHaveBeenCalledWith(
    expect.stringContaining('analytics shutdown failed'),
    flushError,
  );
});

it.each([
  [RunOutcome.Aborted, 'cancelled'],
  [RunOutcome.Failed, 'error'],
] as const)(
  'exits a %s run through wizardAbort as %s',
  async (outcome, status) => {
    const failure = { code: ErrorCodes.AgentApiError, message: 'Failed' };
    vi.mocked(runProgram).mockResolvedValue(settled(outcome, failure));
    const { store } = screens();
    await runProgramOnScreens(program(), store, { credentials });
    expect(wizardAbort).toHaveBeenCalledExactlyOnceWith(
      { present: expect.any(Function), exit: expect.anything() },
      expect.objectContaining({ ...failure, status }),
    );
    expect(analytics.shutdown).not.toHaveBeenCalled();
  },
);

it('shows the auth guidance from a decided 401 before the error outro', async () => {
  const detail = { hasSettingsConflict: false, logFilePath: '/tmp/wizard.log' };
  vi.mocked(runProgram).mockResolvedValue(
    settled(RunOutcome.Failed, {
      code: ErrorCodes.AuthInvalidOrExpired,
      message: 'Authentication failed (401)',
      authErrorDetail: detail,
    }),
  );
  const { store } = screens();
  const show = vi.spyOn(store, 'showAuthError');
  await runProgramOnScreens(program(), store, { credentials });
  expect(show).toHaveBeenCalledExactlyOnceWith(detail);
  expect(
    show.mock.invocationCallOrder[0] <
      vi.mocked(wizardAbort).mock.invocationCallOrder[0],
  ).toBe(true);
});

it('rethrows a crash and a failed login for the handoff screen', async () => {
  const crash = new Error('mint refused');
  vi.mocked(runProgram).mockResolvedValueOnce(
    settled(RunOutcome.Crashed, {
      code: ErrorCodes.InternalUnhandled,
      message: crash.message,
      error: crash,
    }),
  );
  const first = screens();
  await expect(
    runProgramOnScreens(program(), first.store, { credentials }),
  ).rejects.toBe(crash);

  // runProgram turns a rejecting credential provider into a failed run.
  vi.mocked(runProgram).mockImplementationOnce(
    async (programId, _input, options) => {
      const rejected = await capabilities(options)
        .login.resolve(programId, { signal })
        .then(() => false)
        .catch(() => true);
      return settled(rejected ? RunOutcome.Failed : RunOutcome.Success);
    },
  );
  const cancelled = new Error('OAuth cancelled');
  const second = screens();
  await expect(
    runProgramOnScreens(program(), second.store, {
      credentials: { resolve: () => Promise.reject(cancelled) },
    }),
  ).rejects.toBe(cancelled);
  expect(wizardAbort).not.toHaveBeenCalled();
});

it('returns quietly when the signal aborted the run, leaving the exit to its handler', async () => {
  const controller = new AbortController();
  vi.mocked(runProgram).mockImplementation(() => {
    controller.abort();
    return Promise.resolve(
      settled(RunOutcome.Aborted, {
        code: ErrorCodes.AgentAbort,
        message: 'cancelled',
      }),
    );
  });
  const { store } = screens();
  await expect(
    runProgramOnScreens(program(), store, {
      credentials,
      signal: controller.signal,
    }),
  ).resolves.toBeUndefined();
  expect(wizardAbort).not.toHaveBeenCalled();
  expect(analytics.shutdown).not.toHaveBeenCalled();
});

it('asks about a settings conflict it cannot neutralize on the overlay, then runs', async () => {
  // runProgram hands the host a conflict it cannot neutralize (run-program.test.ts).
  let ran = false;
  vi.mocked(runProgram).mockImplementationOnce(
    async (programId, { store: sessions }, options) => {
      const go = await capabilities(options).workflow.confirmStep(
        {
          kind: 'settings-conflict',
          programId,
          installDir: sessions.session.installDir,
          conflicts: [
            {
              source: 'managed',
              path: '/etc/claude/managed-settings.json',
              keys: ['ANTHROPIC_BASE_URL'],
              writable: false,
            },
          ],
          fix: () => true,
        },
        { signal },
      );
      ran = go;
      return settled(RunOutcome.Success);
    },
  );
  const { store } = screens();
  const ask = vi
    .spyOn(store, 'showSettingsOverride')
    .mockResolvedValue(undefined);
  await runProgramOnScreens(program(), store, { credentials });
  expect(ask).toHaveBeenCalledOnce();
  expect(wizardAbort).not.toHaveBeenCalled();
  expect(ran).toBe(true);
});
