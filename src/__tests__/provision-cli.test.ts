// Mock functions must be defined before imports (jest hoists jest.mock calls;
// variables starting with "mock" are allowed in the factory scope).
const mockProvisionNewAccount = jest.fn();

jest.mock('semver', () => ({ satisfies: () => true }));
jest.mock('../utils/provisioning', () => ({
  provisionNewAccount: mockProvisionNewAccount,
}));
// Same supporting mocks as src/__tests__/cli.test.ts — bin.ts imports these
// at module load regardless of which subcommand yargs dispatches.
jest.mock('../lib/wizard-session', () => ({
  buildSession: jest.fn((args: Record<string, unknown>) => args),
}));
jest.mock('../ui/tui/start-tui', () => ({
  startTUI: () => ({
    unmount: jest.fn(),
    store: {
      session: {},
      runReadyHooks: jest.fn().mockResolvedValue(undefined),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      getGate: jest.fn().mockReturnValue(new Promise(() => {})),
      subscribe: jest.fn(),
      onEnterScreen: jest.fn(),
    },
  }),
}));
jest.mock('../lib/workflows/posthog-integration/index', () => ({
  posthogIntegrationConfig: {
    flowKey: 'posthog-integration',
    steps: [],
    run: null,
  },
}));
jest.mock('../utils/environment', () => ({
  isNonInteractiveEnvironment: () => false,
  readEnvironment: () => ({}),
}));
jest.mock('../utils/env-api-key', () => ({
  readApiKeyFromEnv: () => undefined,
}));
jest.mock('../utils/debug', () => ({
  configureLogFileFromEnvironment: jest.fn(),
  logToFile: jest.fn(),
}));
jest.mock('../lib/registry', () => ({ FRAMEWORK_REGISTRY: {} }));
jest.mock('../lib/detection/index', () => ({
  detectFramework: jest.fn().mockResolvedValue(null),
  gatherFrameworkContext: jest.fn().mockResolvedValue({}),
}));
jest.mock('../utils/analytics', () => ({
  analytics: { setTag: jest.fn() },
}));
jest.mock('../utils/wizard-abort', () => ({ wizardAbort: jest.fn() }));
jest.mock('../lib/agent/agent-runner', () => ({
  runAgent: jest.fn().mockResolvedValue(undefined),
}));

describe('wizard provision subcommand', () => {
  const originalArgv = process.argv;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalExit = process.exit;
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const originalIsTTY = process.stdout.isTTY;

  let stdoutChunks: string[];
  let stderrChunks: string[];
  let consoleLogSpy: jest.SpyInstance;

  const successResult = {
    projectApiKey: 'phc_test',
    host: 'https://us.posthog.com',
    projectId: 'proj_1',
    accountId: 'acc_1',
    accessToken: 'access_token',
    refreshToken: 'refresh_token',
    personalApiKey: 'phx_test',
  };

  beforeEach(() => {
    jest.clearAllMocks();
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

    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {
      // suppress LoggingUI output during tests
    });

    // process.exit is always the final call in each branch of the provision
    // handler, so a silent no-op is enough. Throwing here would escape the
    // void async IIFE and become an unhandled rejection.
    process.exit = jest.fn() as unknown as typeof process.exit;
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
    jest.resetModules();
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
      jest.isolateModules(() => {
        require('../../bin.ts');
      });
    } catch {
      // process.exit mock throws to halt handler execution
    }
    // Dynamic import + async handler need several microtask flushes
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  test('exits non-zero without calling the API when --email is missing', async () => {
    setTTY(true);
    await runCLI([]);
    expect(mockProvisionNewAccount).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test('uppercases --region before calling provisionNewAccount', async () => {
    setTTY(true);
    mockProvisionNewAccount.mockResolvedValue(successResult);
    await runCLI(['--email', 'user@example.com', '--region', 'eu']);
    expect(mockProvisionNewAccount).toHaveBeenCalledWith(
      'user@example.com',
      '',
      'EU',
    );
  });

  test('forwards --name to provisionNewAccount', async () => {
    setTTY(true);
    mockProvisionNewAccount.mockResolvedValue(successResult);
    await runCLI([
      '--email',
      'user@example.com',
      '--name',
      'Test User',
      '--region',
      'us',
    ]);
    expect(mockProvisionNewAccount).toHaveBeenCalledWith(
      'user@example.com',
      'Test User',
      'US',
    );
  });

  test('--json emits a single JSON object of the full ProvisioningResult', async () => {
    setTTY(true);
    mockProvisionNewAccount.mockResolvedValue(successResult);
    await runCLI(['--email', 'user@example.com', '--json']);
    const out = stdoutChunks.join('').trim();
    expect(JSON.parse(out)).toEqual(successResult);
    // Human log lines should not also appear on stdout
    expect(stdoutChunks.join('')).not.toContain('API Key:');
  });

  test('auto-enables JSON output when stdout is not a TTY', async () => {
    setTTY(false);
    mockProvisionNewAccount.mockResolvedValue(successResult);
    await runCLI(['--email', 'user@example.com']);
    const out = stdoutChunks.join('').trim();
    expect(JSON.parse(out)).toEqual(successResult);
  });

  test('uses human-readable output when TTY and --json not set', async () => {
    setTTY(true);
    mockProvisionNewAccount.mockResolvedValue(successResult);
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
    mockProvisionNewAccount.mockRejectedValue(
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
    mockProvisionNewAccount.mockRejectedValue(new Error('network unreachable'));
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
