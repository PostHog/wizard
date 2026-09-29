/** The headless host end to end, with runProgram and the network stubbed. */
import type { AgentProgress } from '@agent/types';
import { RunOutcome, runProgram } from '@programs';
import type { ProgramConfig, ProgramRunOutcome } from '@programs/types';
import { Harness, Sequence } from '@shared/constants';
import { ErrorCodes } from '@shared/errors';
import { HostResolution } from '@shared/host-resolution';
import { OutroKind } from '@shared/outro';
import { resetOAuthSession } from '@shared/oauth-session';
import { analytics } from '@utils/analytics';
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
vi.mock(import('@shared/ci-gateway'), () => ({
  readCiGatewayCredential: () => null as never,
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
const serve = vi.hoisted(() => vi.fn());
vi.mock(import('../control/serve'), () => ({ serveHeadlessControl: serve }));

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
let log: { mockRestore(): void };
beforeEach(() => {
  vi.clearAllMocks();
  resetOAuthSession();
  lines = [];
  log = vi
    .spyOn(console, 'log')
    .mockImplementation((line: string) => void lines.push(line));
  vi.mocked(runProgram).mockImplementation((_id, _input, options) => {
    const progress = deliver(options);
    progress({ kind: 'lifecycle', phase: 'started' });
    progress({ kind: 'status', message: 'Working' });
    progress({ kind: 'lifecycle', phase: 'completed', message: 'Done' });
    return Promise.resolve(settled(RunOutcome.Success));
  });
});
afterEach(() => log.mockRestore());

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
      printAbortOutro,
      expect.objectContaining({ ...failure, status }),
    );
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining(`phw-error: {"code":"${failure.code}"`),
    );
    stderr.mockRestore();
    // The stream's last push reads the store: it carries the failure's code.
    const store = stream.store.current as {
      session: { outroData: { kind: string; errorCode?: string } | null };
    };
    expect(store.session.outroData).toMatchObject({
      kind: OutroKind.Error,
      errorCode: failure.code,
    });
    expect(analytics.shutdown).not.toHaveBeenCalledWith('success');
  },
);

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
  await runHeadless(program(), launch());
  expect(wizardAbort).not.toHaveBeenCalled();
  expect(stream.shutdown).toHaveBeenCalledWith(2000, 'completed');
  expect(logToFile).toHaveBeenCalledWith(
    expect.stringContaining('analytics shutdown failed'),
    flushError,
  );
});

it('a signal cancels the run, settles the stream as cancelled and resolves 143 on SIGTERM', async () => {
  const controller = new AbortController();
  vi.mocked(runProgram).mockImplementation(
    () => new Promise(() => controller.abort('SIGTERM')),
  );
  // The stub run ignores the abort, so it never returns.
  await expect(
    runHeadless(program(), launch({ signal: controller.signal })),
  ).resolves.toBe(143);
  expect(wizardAbort).toHaveBeenCalledWith(printAbortOutro, {
    exitCode: 143,
  });
  expect(stream.shutdown).toHaveBeenCalledWith(2000, 'cancelled');
});

it('a signal while serving control resolves 143, not 0', async () => {
  const controller = new AbortController();
  // The server releases on the same abort that fires the host's signal handler.
  serve.mockImplementation(({ signal }: { signal: AbortSignal }) => {
    controller.abort('SIGTERM');
    return signal.aborted ? Promise.resolve() : new Promise(() => undefined);
  });
  await expect(
    runHeadless(
      program(),
      launch({
        signal: controller.signal,
        control: { socketPath: '/tmp/control.sock', mode: 'full' },
      }),
    ),
  ).resolves.toBe(143);
});
