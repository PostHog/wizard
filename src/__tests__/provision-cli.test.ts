// Mock functions are created via vi.hoisted so they exist before the hoisted
// vi.mock factories that reference them run.
const { mockProvisionNewAccountSubcmd } = vi.hoisted(() => ({
  mockProvisionNewAccountSubcmd: vi.fn(),
}));

vi.mock('semver', () => ({ satisfies: () => true }));
vi.mock('../utils/provisioning', () => ({
  provisionNewAccount: mockProvisionNewAccountSubcmd,
}));
// Same supporting mocks as src/__tests__/cli.test.ts — bin.ts imports these
// at module load regardless of which subcommand yargs dispatches.
vi.mock('../lib/wizard-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/wizard-session')>()),
  buildSession: vi.fn((args: Record<string, unknown>) => args),
}));
vi.mock('../ui/tui/start-tui', () => ({
  startTUI: () => ({
    unmount: vi.fn(),
    store: {
      session: {},
      runReadyHooks: vi.fn().mockResolvedValue(undefined),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      getGate: vi.fn().mockReturnValue(new Promise(() => {})),
      subscribe: vi.fn(),
      onEnterScreen: vi.fn(),
    },
  }),
}));
vi.mock('../lib/programs/posthog-integration/index', () => ({
  posthogIntegrationConfig: {
    id: 'posthog-integration',
    steps: [],
    run: null,
  },
  integrationRunStep: {
    id: 'run',
    label: 'Integration',
    screenId: 'run',
    run: () => Promise.resolve(),
  },
}));
vi.mock('../utils/environment', () => ({
  isNonInteractiveEnvironment: () => false,
  readEnvironment: () => ({}),
}));
vi.mock('../utils/env-api-key', () => ({
  readApiKeyFromEnv: () => undefined,
}));
vi.mock('../utils/debug', () => ({
  configureLogFileFromEnvironment: vi.fn(),
  logToFile: vi.fn(),
}));
vi.mock('../lib/registry', () => ({ FRAMEWORK_REGISTRY: {} }));
vi.mock('../lib/detection/index', () => ({
  detectFramework: vi.fn().mockResolvedValue(null),
  gatherFrameworkContext: vi.fn().mockResolvedValue({}),
}));
vi.mock('../utils/analytics', () => ({
  analytics: { setTag: vi.fn() },
}));
vi.mock('../utils/wizard-abort', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/wizard-abort')>()),
  wizardAbort: vi.fn(),
}));
vi.mock('../lib/agent/agent-runner', () => ({
  runAgent: vi.fn().mockResolvedValue(undefined),
}));

import { provisionCommand } from '../commands/provision';
import { parseCommand } from './helpers/parse-command.no-jest';

describe('provision parsing (end-to-end yargs)', () => {
  test('parses --email and --region', async () => {
    const argv = await parseCommand(
      provisionCommand,
      'provision --email a@b.com --region eu',
    );
    expect(argv.email).toBe('a@b.com');
    expect(argv.region).toBe('eu');
  });

  test('rejects when --email is missing (demandOption)', async () => {
    await expect(
      parseCommand(provisionCommand, 'provision --region us'),
    ).rejects.toThrow(/email/i);
  });
});

describe('wizard provision subcommand', () => {
  const originalArgv = process.argv;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalExit = process.exit;
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const originalIsTTY = process.stdout.isTTY;

  let stdoutChunks: string[];
  let stderrChunks: string[];
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  const successResult = {
    projectApiKey: 'phc_test',
    host: 'https://us.posthog.com',
    projectId: 'proj_1',
    accountId: 'acc_1',
    accessToken: 'access_token',
    refreshToken: 'refresh_token',
    personalApiKey: 'phx_test',
  };

  // The success path calls process.exit(0) at the end of bin.ts's detached
  // `void (async () => …)()` dispatch. Our throwing exit mock turns that into an
  // unhandled rejection with no catch site. Swallow exactly that sentinel (the
  // asserted work already ran before exit); re-throw anything else so genuine
  // errors still fail the run.
  const swallowExitRejection = (reason: unknown) => {
    if (reason instanceof Error && reason.message === 'process.exit() called') {
      return;
    }
    throw reason;
  };
  beforeAll(() => {
    process.on('unhandledRejection', swallowExitRejection);
  });
  afterAll(() => {
    process.off('unhandledRejection', swallowExitRejection);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutChunks = [];
    stderrChunks = [];

    process.stdout.write = ((chunk: unknown) => {
      stdoutChunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: unknown) => {
      stderrChunks.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {
      // suppress LoggingUI output during tests
    });

    // The CLI quits via process.exit(); the mock throws so a validation failure
    // (yargs `.fail()` during parse) halts BEFORE the command handler runs —
    // otherwise the handler would call provisionNewAccount with invalid input.
    // The call is still recorded before the throw, so `toHaveBeenCalledWith`
    // assertions hold. On the success path exit(0) runs at the end of bin.ts's
    // detached `void (async () => …)()` dispatch, so its throw escapes as an
    // unhandled rejection — swallowed by the suite-level handler below (the
    // asserted work has already run by then).
    process.exit = vi.fn(() => {
      throw new Error('process.exit() called');
    }) as unknown as typeof process.exit;
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exit = originalExit;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalIsTTY,
      configurable: true,
    });
    consoleLogSpy.mockRestore();
    vi.resetModules();
  });

  function setTTY(isTTY: boolean) {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: isTTY,
      configurable: true,
    });
  }

  async function runCLI(args: string[]) {
    process.argv = ['node', 'bin.ts', 'provision', ...args];
    try {
      // vi.resetModules() re-evaluates bin.ts fresh on each call — the vitest
      // equivalent of jest.isolateModules.
      vi.resetModules();
      await import('../../bin');
    } catch {
      // bin.ts dispatch can reject on some parse paths; the run's effect is
      // asserted via the mocks after settle().
    }
    await settle();
  }

  // The CLI dispatch fires detached async work that awaits a chain of dynamic
  // imports before reaching a mocked sink. Pump the event loop until this run
  // reaches a sink — provisionNewAccount (success) or process.exit (validation
  // failure) — then drain briefly so trailing work finishes inside this test
  // rather than leaking into the next. (Mirrors cli.test.ts's settle.)
  async function settle() {
    const sank = () =>
      mockProvisionNewAccountSubcmd.mock.calls.length > 0 ||
      (process.exit as unknown as ReturnType<typeof vi.fn>).mock.calls.length >
        0;
    for (let i = 0; i < 300 && !sank(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  test('exits non-zero without calling the API when --email is missing', async () => {
    setTTY(true);
    await runCLI([]);
    expect(mockProvisionNewAccountSubcmd).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test('uppercases --region before calling provisionNewAccount', async () => {
    setTTY(true);
    mockProvisionNewAccountSubcmd.mockResolvedValue(successResult);
    await runCLI(['--email', 'user@example.com', '--region', 'eu']);
    expect(mockProvisionNewAccountSubcmd).toHaveBeenCalledWith(
      'user@example.com',
      '',
      'EU',
      { baseUrl: undefined },
    );
  });

  test('forwards --name to provisionNewAccount', async () => {
    setTTY(true);
    mockProvisionNewAccountSubcmd.mockResolvedValue(successResult);
    await runCLI([
      '--email',
      'user@example.com',
      '--name',
      'Test User',
      '--region',
      'us',
    ]);
    expect(mockProvisionNewAccountSubcmd).toHaveBeenCalledWith(
      'user@example.com',
      'Test User',
      'US',
      { baseUrl: undefined },
    );
  });

  test('--json emits a single JSON object of the full ProvisioningResult', async () => {
    setTTY(true);
    mockProvisionNewAccountSubcmd.mockResolvedValue(successResult);
    await runCLI(['--email', 'user@example.com', '--json']);
    const out = stdoutChunks.join('').trim();
    expect(JSON.parse(out)).toEqual(successResult);
    // Human log lines should not also appear on stdout
    expect(stdoutChunks.join('')).not.toContain('API Key:');
  });

  test('auto-enables JSON output when stdout is not a TTY', async () => {
    setTTY(false);
    mockProvisionNewAccountSubcmd.mockResolvedValue(successResult);
    await runCLI(['--email', 'user@example.com']);
    const out = stdoutChunks.join('').trim();
    expect(JSON.parse(out)).toEqual(successResult);
  });

  test('uses human-readable output when TTY and --json not set', async () => {
    setTTY(true);
    mockProvisionNewAccountSubcmd.mockResolvedValue(successResult);
    await runCLI(['--email', 'user@example.com']);
    expect(stdoutChunks.join('')).toBe('');
    // LoggingUI writes via console.log
    const consoleOutput = consoleLogSpy.mock.calls
      .map((call: unknown[]) => String(call[0]))
      .join('\n');
    expect(consoleOutput).toContain('API Key:');
    expect(consoleOutput).toContain(successResult.projectApiKey);
  });

  test('emits email_exists code when email is already associated', async () => {
    setTTY(false);
    mockProvisionNewAccountSubcmd.mockRejectedValue(
      new Error(
        'This email is already associated with a PostHog account. Please use the login flow instead.',
      ),
    );
    await runCLI(['--email', 'user@example.com']);
    const err = stderrChunks.join('').trim();
    const parsed = JSON.parse(err) as { error: string; code: string };
    expect(parsed.code).toBe('email_exists');
    expect(parsed.error).toContain('already associated');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test('uses provisioning_failed code for other errors', async () => {
    setTTY(false);
    mockProvisionNewAccountSubcmd.mockRejectedValue(
      new Error('network unreachable'),
    );
    await runCLI(['--email', 'user@example.com']);
    const parsed = JSON.parse(stderrChunks.join('').trim()) as {
      error: string;
      code: string;
    };
    expect(parsed.code).toBe('provisioning_failed');
    expect(parsed.error).toBe('network unreachable');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
