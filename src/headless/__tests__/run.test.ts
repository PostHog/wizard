/** The headless host end to end, with runProgram and the network stubbed. */
import type { AgentProgress } from '@agent/types';
import { RunOutcome, runProgram } from '@programs';
import type { ProgramConfig, ProgramRunOutcome } from '@programs/types';
import { Harness, Sequence } from '@shared/constants';
import { ErrorCodes } from '@shared/errors';
import { HostResolution } from '@shared/host-resolution';
import { OutroKind } from '@shared/outro';
import { resetOAuthSession } from '@shared/oauth-session';
import { readCiGatewayCredential } from '@shared/ci-gateway';
import { analytics } from '@utils/analytics';
import { registerCleanup } from '@utils/cleanup';
import { logToFile } from '@utils/debug';
import { wizardAbort } from '@host/wizard-abort';
import { printAbortOutro } from '@shared/console-log';
import { runHeadless, type HeadlessLaunch } from '../run';

const stream = vi.hoisted(() => ({
  destinations: vi.fn(),
  shutdown: vi.fn().mockResolvedValue(undefined),
  store: { current: null as unknown },
}));
vi.mock(import('@programs'), async (original) => ({
  ...(await original()),
  apiKeyCredentials: () => ({
    resolve: () =>
      Promise.resolve({
        posthog: {
          accessToken: 'phx_test',
          projectApiKey: 'phc_test',
          projectId: 1,
          host: HostResolution.fromApiHost('https://us.posthog.com'),
        },
        project: null,
        apiUser: null,
      }),
  }),
  TaskStreamPush: class {
    constructor(opts: {
      destinations: Array<{ name: string }>;
      store: unknown;
    }) {
      stream.destinations(opts.destinations.map((d) => d.name));
      stream.store.current = opts.store;
    }
    attach = vi.fn();
    shutdown = stream.shutdown;
  } as never,
  PostHogDestination: class {
    readonly name = 'posthog';
  } as never,
  createFileDestination: (value: unknown) =>
    value === undefined
      ? null
      : ({ name: 'file', path: '/tmp/stream.jsonl' } as never),
  runProgram: vi.fn(),
}));
vi.mock(import('@shared/local-dev'), async (original) => ({
  ...(await original()),
  checkLocalServices: vi.fn().mockResolvedValue(null),
}));
const ciGateway = vi.hoisted(() => ({
  token: 'gw_test',
  url: 'https://ai-gateway.eu.posthog.com',
}));
vi.mock(import('@shared/ci-gateway'), () => ({
  readCiGatewayCredential: vi.fn(() => ciGateway),
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
    getCachedWizardFlags: vi.fn().mockReturnValue(null),
    shutdown: vi.fn().mockResolvedValue(undefined),
  } as never,
  groupsFromUser: () => ({}),
  sessionProperties: () => ({}),
}));
vi.mock(import('@host/wizard-abort'), async (original) => {
  const abort = await original();
  return { ...abort, wizardAbort: vi.fn(abort.wizardAbort) };
});

const program = (): ProgramConfig => ({
  id: 'metrics',
  description: 'Test',
  healthCheck: false,
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
/** The program's progress, as runProgram delivers it. */
const deliver =
  (options: Parameters<typeof runProgram>[2]) => (event: AgentProgress) =>
    options?.onProgress?.({ runId: 'run-1', event });
const launch = (over: Partial<HeadlessLaunch> = {}): HeadlessLaunch => ({
  mode: 'headless',
  session: {
    installDir: '/tmp/headless-test',
    apiKey: 'phx_test',
    projectId: '1',
    noTelemetry: false,
  },
  signal: new AbortController().signal,
  ...over,
});

let lines: string[];
beforeEach(() => {
  vi.clearAllMocks();
  resetOAuthSession();
  lines = [];
  vi.spyOn(console, 'log').mockImplementation(
    (line: string) => void lines.push(line),
  );
  vi.mocked(runProgram).mockImplementation((_id, _input, options) => {
    const progress = deliver(options);
    progress({ kind: 'lifecycle', phase: 'started' });
    progress({ kind: 'status', message: 'Working' });
    progress({ kind: 'lifecycle', phase: 'completed', message: 'Done' });
    return Promise.resolve(settled(RunOutcome.Success));
  });
});
afterEach(() => vi.restoreAllMocks());

it.each([
  [Harness.pi, Sequence.linear],
  [Harness.anthropic, Sequence.orchestrator],
])(
  'runs %s/%s: the launch overrides reach the run, one terminal event, then the stream settles',
  async (harness, sequence) => {
    await expect(
      runHeadless(
        program(),
        launch({
          session: { ...launch().session, harness, sequence },
        }),
      ),
    ).resolves.toBe(0);
    expect(wizardAbort).not.toHaveBeenCalled();
    expect(analytics.shutdown).toHaveBeenCalledExactlyOnceWith('success');
    expect(
      vi.mocked(analytics.shutdown).mock.invocationCallOrder[0],
    ).toBeLessThan(stream.shutdown.mock.invocationCallOrder[0]);
    expect(stream.shutdown).toHaveBeenCalledWith(2000, 'completed');
    // runProgram routes the agent by the store's launch values (run-program.test.ts).
    const [programId, { store }] = vi.mocked(runProgram).mock.calls[0];
    expect(programId).toBe('metrics');
    expect(store.session).toMatchObject({ harness, sequence, ci: true });
    expect(lines).toContain('◇  Working');
    expect(lines).toContain('└  Done');
  },
);

it.each([
  ['headless', ['posthog']],
  ['ci', ['file']],
] as const)(
  'a %s run streams to %j: CI is synthetic, so it dumps locally and never pushes',
  async (mode, destinations) => {
    await runHeadless(program(), launch({ mode }));
    expect(stream.destinations).toHaveBeenCalledWith(destinations);
    expect(analytics.setTag).toHaveBeenCalledWith('build', mode);
  },
);

it.each([
  ['ci', ciGateway],
  ['headless', null],
] as const)(
  'a %s run holds the pre-issued gateway token for its region: %j',
  async (mode, expected) => {
    await runHeadless(
      program(),
      launch({ mode, session: { ...launch().session, region: 'eu' } }),
    );
    const [, { store }] = vi.mocked(runProgram).mock.calls[0];
    expect(store.session.ciGateway).toEqual(expected);
    if (expected) {
      expect(readCiGatewayCredential).toHaveBeenCalledExactlyOnceWith('eu');
    } else {
      expect(readCiGatewayCredential).not.toHaveBeenCalled();
    }
  },
);

it.each([
  [RunOutcome.Aborted, 'cancelled'],
  [RunOutcome.Failed, 'error'],
] as const)(
  'ends a %s run through wizardAbort as %s with code 1, the failure already in the store',
  async (outcome, status) => {
    const failure = { code: ErrorCodes.AgentApiError, message: 'Failed' };
    // runProgram settles its store with the failure before it resolves.
    vi.mocked(runProgram).mockImplementation((_id, { store }) => {
      store.setOutroData({
        kind: OutroKind.Error,
        message: failure.message,
        errorCode: failure.code,
      });
      return Promise.resolve(settled(outcome, failure));
    });
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    await expect(runHeadless(program(), launch())).resolves.toBe(1);
    expect(wizardAbort).toHaveBeenCalledExactlyOnceWith(
      { present: printAbortOutro, exit: expect.anything() },
      expect.objectContaining({ ...failure, status }),
    );
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining(`phw-error: {"code":"${failure.code}"`),
    );
    expect(stream.shutdown).toHaveBeenCalledWith(
      2000,
      status === 'cancelled' ? 'cancelled' : 'failed',
    );
    expect(analytics.shutdown).not.toHaveBeenCalledWith('success');
  },
);

it("prints the gateway's 401 guidance before it ends the run", async () => {
  vi.mocked(runProgram).mockResolvedValue(
    settled(RunOutcome.Failed, {
      code: ErrorCodes.AgentApiError,
      message: 'Authentication failed (401)',
      authErrorDetail: {
        hasSettingsConflict: false,
        logFilePath: '/tmp/wizard.log',
      },
    }),
  );
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  await expect(runHeadless(program(), launch())).resolves.toBe(1);
  const guidance = lines.indexOf(
    '│    - Missing scope: the personal API key needs the "llm_gateway:read" scope.',
  );
  expect(guidance).toBeGreaterThanOrEqual(0);
  expect(guidance).toBeLessThan(
    lines.lastIndexOf('✖  Authentication failed (401)'),
  );
});

// runProgram delivers a CI detection's log lines as the program's progress (run-program.test.ts).
it('prints what a CI detection logs', async () => {
  vi.mocked(runProgram).mockImplementation((_id, _input, options) => {
    const progress = deliver(options);
    progress({ kind: 'log', level: 'info', message: 'Scanning the repo' });
    progress({ kind: 'log', level: 'warn', message: 'Scan failed' });
    return Promise.resolve(settled(RunOutcome.Success));
  });
  await runHeadless(program(), launch({ mode: 'ci' }));
  expect(lines).toContain('│  Scanning the repo');
  expect(lines).toContain('▲  Scan failed');
});

it('keeps a run a success when its terminal analytics flush fails', async () => {
  const flushError = new Error('flush timed out');
  vi.mocked(analytics.shutdown).mockRejectedValueOnce(flushError);
  await expect(runHeadless(program(), launch())).resolves.toBe(0);
  expect(wizardAbort).not.toHaveBeenCalled();
  expect(stream.shutdown).toHaveBeenCalledWith(2000, 'completed');
  expect(logToFile).toHaveBeenCalledWith(
    expect.stringContaining('analytics shutdown failed'),
    flushError,
  );
});

it.each([
  ['SIGINT', 130],
  ['SIGTERM', 143],
  ['SIGHUP', 130],
] as const)(
  'a %s cancels the run and runs the cleanups, settles the stream as cancelled and resolves %i',
  async (name, code) => {
    const controller = new AbortController();
    const cleanup = vi.fn();
    registerCleanup(cleanup);
    let runSignal: AbortSignal | undefined;
    // The run ends Aborted once its signal fires, as a real one does.
    vi.mocked(runProgram).mockImplementation(
      (_id, _input, options) =>
        new Promise((resolve) => {
          runSignal = options?.signal;
          runSignal?.addEventListener('abort', () =>
            resolve(settled(RunOutcome.Aborted)),
          );
          controller.abort(name);
        }),
    );
    await expect(
      runHeadless(program(), launch({ signal: controller.signal })),
    ).resolves.toBe(code);
    expect(runSignal?.aborted).toBe(true);
    expect(cleanup).toHaveBeenCalledOnce();
    // The cancelled result does not end the run a second time, as a failure.
    expect(wizardAbort).toHaveBeenCalledExactlyOnceWith(
      { present: printAbortOutro, exit: expect.anything() },
      { exitCode: code },
    );
    expect(stream.shutdown).toHaveBeenCalledWith(2000, 'cancelled');
    // The cleanups are sync, so they run before a stream flush that may time out.
    expect(cleanup.mock.invocationCallOrder[0]).toBeLessThan(
      stream.shutdown.mock.invocationCallOrder[0],
    );
  },
);

it('a signal that landed before the host subscribed ends the run without starting it', async () => {
  const controller = new AbortController();
  controller.abort('SIGTERM');
  await expect(
    runHeadless(program(), launch({ signal: controller.signal })),
  ).resolves.toBe(143);
  expect(runProgram).not.toHaveBeenCalled();
});
