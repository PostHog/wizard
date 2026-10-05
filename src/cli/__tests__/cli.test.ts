// Mock functions are created via vi.hoisted so they exist before the hoisted
// vi.mock factories that reference them run.
// NOTE: variable names must be unique across test files because .test.ts
// files without top-level imports/exports share a single TS project scope.
const {
  mockRunTuiCli,
  mockRunHeadlessCli,
  mockProvisionNewAccountCli,
  mockConfigureLogFileCli,
} = vi.hoisted(() => ({
  mockConfigureLogFileCli: vi.fn(),
  // The TUI host parks on its intro; headless resolves 0.
  mockRunTuiCli: vi.fn(
    (..._args: Parameters<typeof import('@tui').runTui>) =>
      new Promise<number>(() => undefined),
  ),
  mockRunHeadlessCli: vi.fn(
    (..._args: Parameters<typeof import('@headless').runHeadless>) =>
      Promise.resolve(0),
  ),
  mockProvisionNewAccountCli: vi.fn(),
}));

// The CLI's job ends at the host: it parses arguments, picks the TUI or the
// headless host, and hands it the launch values. These stand in for the hosts.
vi.mock(import('@tui'), async (importOriginal) => ({
  ...(await importOriginal()),
  runTui: mockRunTuiCli,
}));
vi.mock(import('@headless'), async (importOriginal) => ({
  ...(await importOriginal()),
  runHeadless: mockRunHeadlessCli,
}));

vi.mock('semver', () => ({ satisfies: () => true }));
vi.mock('@utils/provisioning', () => ({
  provisionNewAccount: mockProvisionNewAccountCli,
}));
vi.mock(import('@programs/posthog-integration'), () => ({
  config: {
    id: 'posthog-integration',
    steps: [],
    run: null,
  } as never,
}));
vi.mock('@utils/environment', () => ({
  isNonInteractiveEnvironment: () => false,
  readEnvironment: () => ({}),
}));
// CI-path dynamic imports need mocks to prevent unhandled rejections
vi.mock('@utils/env-api-key', () => ({
  readApiKeyFromEnv: () => undefined,
}));
vi.mock('@utils/debug', () => ({
  logToFile: vi.fn(),
  configureLogFile: mockConfigureLogFileCli,
  configureLogFileFromEnvironment: vi.fn(),
}));
vi.mock('@utils/analytics', () => ({
  analytics: {
    setTag: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock(import('@host/wizard-abort'), async (importOriginal) => ({
  ...(await importOriginal()),
  wizardAbort: vi.fn(),
}));

describe('CLI argument parsing', () => {
  const originalArgv = process.argv;
  const originalSignals = new Map(
    (['SIGINT', 'SIGTERM'] as const).map(
      (signal) => [signal, process.listeners(signal)] as const,
    ),
  );
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalExit = process.exit;

  // The wizard's env vars that individual tests set. Cleared around each test
  // by mutating the live process.env in place — reassigning `process.env` to a
  // fresh object (as this used to) defeats yargs' `.env()` reader once the
  // module graph has been reset and yargs re-imported, so env-only flags stop
  // being picked up.
  const WIZARD_ENV_KEYS = [
    'POSTHOG_WIZARD_REGION',
    'POSTHOG_WIZARD_CI',
    'POSTHOG_WIZARD_API_KEY',
    'POSTHOG_WIZARD_INSTALL_DIR',
    'POSTHOG_WIZARD_LOCAL_DEV',
    'POSTHOG_WIZARD_LOCAL_CONTEXT_MILL',
    'POSTHOG_WIZARD_LOCAL_MCP',
    'POSTHOG_WIZARD_LOCAL_POSTHOG',
    'POSTHOG_TASK_RUN_ID',
    'POSTHOG_WIZARD_RUN_ID',
    'POSTHOG_TASK_ID',
  ];
  const clearWizardEnv = () => {
    for (const key of WIZARD_ENV_KEYS) delete process.env[key];
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset environment
    clearWizardEnv();

    // Mock process.exit so the test runner doesn't exit. The CLI dispatch is
    // async (it dynamically imports the matched command file), so a throwing
    // mock would escape as an unhandled rejection rather than halting the
    // handler. A no-op suffices: validation failures `return` right after
    // calling exit, and tests assert on the recorded exit code.
    process.exit = vi.fn() as unknown as typeof process.exit;
  });

  afterEach(() => {
    for (const [signal, original] of originalSignals) {
      for (const listener of process.listeners(signal)) {
        if (!original.includes(listener))
          process.removeListener(signal, listener);
      }
    }
    process.argv = originalArgv;
    process.exit = originalExit;
    clearWizardEnv();
    vi.resetModules();
  });

  /**
   * Helper to run the CLI with given arguments
   */
  async function runCLI(args: string[]) {
    process.argv = ['node', 'bin.ts', ...args];

    try {
      // vi.resetModules() (afterEach) clears the registry, so this builds the
      // command line fresh on every call, as bin.ts does.
      const { runCli } = await import('../index');
      runCli();
    } catch {
      // process.exit mock throws to halt handler execution
    }

    await settle();
  }

  async function settle() {
    // The CLI dispatch fires detached async work (`void (async () => …)()`)
    // that awaits a deep chain of dynamic imports before reaching a mocked
    // sink. Under jest these imports were synchronous (babel-commonjs), so the
    // chain completed within runCLI; under the real ESM runner it spans many
    // async turns.
    //
    // First anchor: pump the event loop until this run reaches a sink —
    // a host (success paths) or process.exit (validation-failure paths).
    // This guarantees the run has acted before we return, so it can't leak a
    // first sink call into the next test.
    // Poll on a real timer (not a fixed event-loop-turn count): afterEach's
    // vi.resetModules() forces a full graph reload from disk on every run, so
    // the chain is I/O-bound and can be starved when vitest runs files in
    // parallel. A wall-clock budget tolerates that load; it returns as soon as
    // the sink fires, so the budget is only spent in the worst case.
    const sank = () =>
      mockRunTuiCli.mock.calls.length > 0 ||
      mockRunHeadlessCli.mock.calls.length > 0 ||
      (process.exit as unknown as Mock).mock.calls.length > 0;
    for (let i = 0; i < 300 && !sank(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    // Then drain: process.exit is a no-op here, so a validation-failure chain
    // keeps running past it and may still reach a host. A short wait lets
    // that trailing work finish inside this test rather than leaking into the
    // next one. (Success chains past their sink only park on the never-resolving
    // intro gate or hit mocked no-ops.)
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  /** The launch values the last host was handed; every path builds its session from them. */
  function getLastBuildSessionArgs(): Record<string, unknown> {
    const calls = [
      ...mockRunTuiCli.mock.calls,
      ...mockRunHeadlessCli.mock.calls,
    ];
    expect(calls.length).toBeGreaterThan(0);
    return calls[calls.length - 1][1].session;
  }

  /** The mode the headless host was started in. */
  function headlessMode(): string {
    const calls = mockRunHeadlessCli.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return calls[calls.length - 1][1].mode;
  }

  // Note: --region reaches the session only on the non-interactive paths;
  // interactively it's ignored (OAuth reads the region off the token
  // response), so the non-CI cases just assert parsing succeeds.

  describe('--region flag', () => {
    test.each(['us', 'eu'])(
      'accepts "%s" as a valid region',
      async (region) => {
        await runCLI(['--region', region]);
        expect(mockRunTuiCli).toHaveBeenCalled();
      },
    );
  });

  describe('environment variables', () => {
    test('respects POSTHOG_WIZARD_REGION', async () => {
      process.env.POSTHOG_WIZARD_REGION = 'eu';

      await runCLI([]);

      expect(mockRunTuiCli).toHaveBeenCalled();
    });

    test('CLI args override environment variables', async () => {
      process.env.POSTHOG_WIZARD_REGION = 'us';

      await runCLI(['--region', 'eu']);

      expect(mockRunTuiCli).toHaveBeenCalled();
    });
  });

  describe('backward compatibility', () => {
    test('all existing flags continue to work', async () => {
      await runCLI(['--debug', '--signup', '--install-dir', '/custom/path']);

      const args = getLastBuildSessionArgs();

      // Existing flags forwarded to the host
      expect(args.debug).toBe(true);
      expect(args.signup).toBe(true);
      expect(args.installDir).toBe('/custom/path');
    });
  });

  // MCP commands now launch TUI — tested via integration tests

  describe('local dev flags', () => {
    // The hosts preflight every requested local server and abort if one is
    // down, which would stop the run. Stub the probe so
    // these assert flag plumbing rather than whether a dev stack happens to be
    // running on this machine. Reachability itself is covered in local-dev.test.
    beforeEach(() => {
      vi.stubGlobal('fetch', () =>
        Promise.resolve(new Response(null, { status: 200 })),
      );
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    // Skills resolve from the process-wide target the middleware sets, not
    // from a launch value — so assert the URL the run would actually fetch.
    async function skillsBaseUrl(): Promise<{ actual: string; local: string }> {
      const { getSkillsBaseUrl, LOCAL_SKILLS_BASE_URL } = await import(
        '@shared/constants'
      );
      return { actual: getSkillsBaseUrl(), local: LOCAL_SKILLS_BASE_URL };
    }

    test('forwards each --local-* target', async () => {
      await runCLI(['--local-context-mill']);
      const { actual, local } = await skillsBaseUrl();
      expect(actual).toBe(local);
      // Absent flags must be undefined, not false — see resolveLocalDev.
      const args = getLastBuildSessionArgs();
      expect(args.localMcp).toBeUndefined();
      expect(args.localPosthog).toBeUndefined();
    });

    test('forwards the --local-dev umbrella', async () => {
      await runCLI(['--local-dev']);
      expect(getLastBuildSessionArgs().localDev).toBe(true);
      const { actual, local } = await skillsBaseUrl();
      expect(actual).toBe(local);
    });

    // The reviewer's bug, end to end: the intro screens used to read the MCP
    // flag to pick a skills registry.
    test('--local-mcp alone leaves skills on production', async () => {
      await runCLI(['--local-mcp']);
      const { actual, local } = await skillsBaseUrl();
      expect(actual).not.toBe(local);
    });

    test('resolves POSTHOG_WIZARD_LOCAL_CONTEXT_MILL from the environment', async () => {
      process.env.POSTHOG_WIZARD_LOCAL_CONTEXT_MILL = 'true';
      await runCLI([]);
      const { actual, local } = await skillsBaseUrl();
      expect(actual).toBe(local);
    });

    // A global `local` would silently erase `--local` from
    // `wizard mcp add --help`; a global's `hidden` beats a command-level one.
    test('no global option is named `local`', async () => {
      const { GLOBAL_OPTIONS } = await import('../wizard');
      expect(Object.keys(GLOBAL_OPTIONS)).not.toContain('local');
    });
  });

  describe('--ci flag', () => {
    test('accepts --region for a flat program command', async () => {
      await runCLI([
        'mcp-analytics',
        '--ci',
        '--region',
        'us',
        '--api-key',
        'phx_test',
        '--install-dir',
        '/tmp/test',
      ]);

      expect(process.exit).not.toHaveBeenCalledWith(1);
    });

    test('defaults to false when not specified', async () => {
      await runCLI([]);

      const args = getLastBuildSessionArgs();
      expect(args.ci).toBe(false);
    });

    test('can be set to true', async () => {
      await runCLI([
        '--ci',
        '--region',
        'us',
        '--api-key',
        'phx_test',
        '--install-dir',
        '/tmp/test',
      ]);

      const args = getLastBuildSessionArgs();
      expect(args.ci).toBe(true);
    });

    test('does not require --region when --ci is set', async () => {
      await runCLI([
        '--ci',
        '--api-key',
        'phx_test',
        '--install-dir',
        '/tmp/test',
      ]);

      expect(process.exit).not.toHaveBeenCalledWith(1);
    });

    test('requires --api-key when --ci is set', async () => {
      await runCLI(['--ci', '--region', 'us', '--install-dir', '/tmp/test']);

      expect(process.exit).toHaveBeenCalledWith(1);
    });

    test('requires --install-dir when --ci is set', async () => {
      await runCLI(['--ci', '--region', 'us', '--api-key', 'phx_test']);

      expect(process.exit).toHaveBeenCalledWith(1);
    });

    test('leaves region unset when --region is not passed', async () => {
      await runCLI([
        '--ci',
        '--api-key',
        'phx_test',
        '--install-dir',
        '/tmp/test',
      ]);

      const args = getLastBuildSessionArgs();
      expect(args.region).toBeUndefined();
    });

    test('starts the headless host in ci mode', async () => {
      await runCLI([
        '--ci',
        '--api-key',
        'phx_test',
        '--install-dir',
        '/tmp/test',
      ]);

      expect(headlessMode()).toBe('ci');
      expect(mockRunTuiCli).not.toHaveBeenCalled();
    });

    // The CI bot authenticates with a wizard-app pha_ token, the same
    // credential headless takes. Either key reaches the host untouched and
    // neither draws the unexpected-prefix warning.
    test.each(['phx_ci_key', 'pha_ci_bot_token'])(
      'accepts %s without a prefix warning',
      async (apiKey) => {
        const log = vi
          .spyOn(console, 'log')
          .mockImplementation(() => undefined);
        try {
          await runCLI([
            '--ci',
            '--api-key',
            apiKey,
            '--install-dir',
            '/tmp/test',
          ]);

          expect(process.exit).not.toHaveBeenCalledWith(1);
          expect(getLastBuildSessionArgs().apiKey).toBe(apiKey);
          const lines = log.mock.calls.map((c) => c.map(String).join(' '));
          expect(lines.some((l) => l.includes('does not start with'))).toBe(
            false,
          );
        } finally {
          log.mockRestore();
        }
      },
    );
  });

  // The experimental headless flag is the published-build sibling of --ci: it
  // routes through the same non-interactive runner (session.ci === true), but
  // is its own flag and tags the build distinctly so the two modes segment in
  // analytics. Its CLI name is intentionally ugly/undocumented — sourced from
  // HEADLESS_FLAG in src/env.ts so this test never has to spell it out.
  describe('headless flag', () => {
    // Source of truth: HEADLESS_FLAG in src/env.ts. Hardcoded
    // here (not imported) to keep this file free of top-level imports — see the
    // note at the top of the file.
    const headlessFlag = '--headless-DONOTUSE-EXPERIMENTAL';

    test("starts the headless host in headless mode (not 'ci')", async () => {
      await runCLI([
        headlessFlag,
        '--api-key',
        'pha_test',
        '--install-dir',
        '/tmp/test',
      ]);

      expect(headlessMode()).toBe('headless');
    });

    // The dispatch checks the headless flag before --ci, so headless wins when
    // both are passed. Not a supported combination, but pin the precedence.
    test('takes precedence over --ci when both are passed', async () => {
      await runCLI([
        '--ci',
        headlessFlag,
        '--api-key',
        'pha_test',
        '--install-dir',
        '/tmp/test',
      ]);

      expect(headlessMode()).toBe('headless');
    });

    test('does not require --region when headless is set', async () => {
      await runCLI([
        headlessFlag,
        '--api-key',
        'pha_test',
        '--install-dir',
        '/tmp/test',
      ]);

      expect(process.exit).not.toHaveBeenCalledWith(1);
    });

    test('requires --api-key when headless is set', async () => {
      await runCLI([headlessFlag, '--install-dir', '/tmp/test']);

      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('CI environment variables', () => {
    test('respects POSTHOG_WIZARD_CI', async () => {
      process.env.POSTHOG_WIZARD_CI = 'true';
      process.env.POSTHOG_WIZARD_REGION = 'us';
      process.env.POSTHOG_WIZARD_API_KEY = 'phx_env_key';
      process.env.POSTHOG_WIZARD_INSTALL_DIR = '/tmp/test';

      await runCLI([]);

      const args = getLastBuildSessionArgs();
      expect(args.ci).toBe(true);
    });

    test('respects POSTHOG_WIZARD_API_KEY', async () => {
      process.env.POSTHOG_WIZARD_CI = 'true';
      process.env.POSTHOG_WIZARD_REGION = 'eu';
      process.env.POSTHOG_WIZARD_API_KEY = 'phx_env_key';
      process.env.POSTHOG_WIZARD_INSTALL_DIR = '/tmp/test';

      await runCLI([]);

      const args = getLastBuildSessionArgs();
      expect(args.apiKey).toBe('phx_env_key');
    });

    test('accepts the task-run identity the sandbox exports', async () => {
      // These two are read straight from the environment, never as CLI options,
      // and their names must stay outside the POSTHOG_WIZARD_ prefix for that to
      // hold: `.env('POSTHOG_WIZARD')` turns every prefixed variable into an
      // option name and `.strictOptions()` fails the run on one it doesn't know,
      // so renaming them under the prefix would exit every cloud run before the
      // wizard does any work.
      process.env.POSTHOG_WIZARD_CI = 'true';
      process.env.POSTHOG_WIZARD_REGION = 'us';
      process.env.POSTHOG_WIZARD_API_KEY = 'phx_env_key';
      process.env.POSTHOG_WIZARD_INSTALL_DIR = '/tmp/test';
      process.env.POSTHOG_TASK_RUN_ID = 'task-run-uuid';
      process.env.POSTHOG_TASK_ID = 'task-uuid';

      await runCLI([]);

      expect(process.exit).not.toHaveBeenCalledWith(1);
    });

    test('POSTHOG_WIZARD_LOG_FILE picks the log file instead of failing the run', async () => {
      process.env.POSTHOG_WIZARD_CI = 'true';
      process.env.POSTHOG_WIZARD_REGION = 'us';
      process.env.POSTHOG_WIZARD_API_KEY = 'phx_env_key';
      process.env.POSTHOG_WIZARD_INSTALL_DIR = '/tmp/test';
      const original = process.env.POSTHOG_WIZARD_LOG_FILE;
      process.env.POSTHOG_WIZARD_LOG_FILE = '/tmp/wizard-cli-test.log';
      try {
        await runCLI([]);
        expect(process.exit).not.toHaveBeenCalledWith(1);
        expect(mockConfigureLogFileCli).toHaveBeenCalledWith({
          path: '/tmp/wizard-cli-test.log',
          pin: true,
        });
      } finally {
        if (original === undefined) delete process.env.POSTHOG_WIZARD_LOG_FILE;
        else process.env.POSTHOG_WIZARD_LOG_FILE = original;
      }
    });

    test('accepts the explicit WizardRun assignment through the strict environment parser', async () => {
      process.env.POSTHOG_WIZARD_CI = 'true';
      process.env.POSTHOG_WIZARD_REGION = 'us';
      process.env.POSTHOG_WIZARD_API_KEY = 'pha_test';
      process.env.POSTHOG_WIZARD_INSTALL_DIR = '/tmp/test';
      process.env.POSTHOG_WIZARD_RUN_ID =
        '019edb1a-cce4-4000-8f6d-682061862da9';
      await runCLI([]);
      expect(process.exit).not.toHaveBeenCalledWith(1);
      expect(getLastBuildSessionArgs().runId).toBeUndefined();
    });

    test('CLI args override CI environment variables', async () => {
      process.env.POSTHOG_WIZARD_CI = 'true';
      process.env.POSTHOG_WIZARD_REGION = 'us';
      process.env.POSTHOG_WIZARD_API_KEY = 'phx_env_key';
      process.env.POSTHOG_WIZARD_INSTALL_DIR = '/tmp/test';

      await runCLI([
        '--region',
        'eu',
        '--api-key',
        'phx_cli_key',
        '--install-dir',
        '/other/path',
      ]);

      const args = getLastBuildSessionArgs();
      expect(args.apiKey).toBe('phx_cli_key');
      expect(args.region).toBe('eu');
    });
  });

  describe('--ci --signup flow', () => {
    // Exits inside the async provisioning IIFE become unhandled rejections if
    // process.exit throws. Override to a silent no-op for this block — the
    // handler's exit calls are always terminal, so "continuing" past them is
    // harmless and lets us assert on both the exit code and mock state.
    beforeEach(() => {
      process.exit = vi.fn() as unknown as typeof process.exit;
    });

    const successResult = {
      projectApiKey: 'phc_new',
      host: 'https://us.posthog.com',
      projectId: 'proj_42',
      accountId: 'acc_1',
      accessToken: 'at',
      refreshToken: 'rt',
      personalApiKey: 'phx_from_signup',
    };

    async function runCISignup(extra: string[] = []) {
      await runCLI([
        '--ci',
        '--signup',
        '--email',
        'new@example.com',
        '--install-dir',
        '/tmp/test',
        ...extra,
      ]);
      // Let the async provisioning and the host's start settle
      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    test('requires --email when --ci --signup is set', async () => {
      await runCLI(['--ci', '--signup', '--install-dir', '/tmp/test']);
      expect(process.exit).toHaveBeenCalledWith(1);
      expect(mockProvisionNewAccountCli).not.toHaveBeenCalled();
    });

    test('rejects --ci without --api-key and without --signup', async () => {
      await runCLI(['--ci', '--install-dir', '/tmp/test']);
      expect(process.exit).toHaveBeenCalledWith(1);
      expect(mockProvisionNewAccountCli).not.toHaveBeenCalled();
    });

    test('provisions a new account and feeds personalApiKey into the CI flow', async () => {
      mockProvisionNewAccountCli.mockResolvedValue(successResult);
      await runCISignup();
      expect(mockProvisionNewAccountCli).toHaveBeenCalledWith(
        'new@example.com',
        '',
        'US',
        { baseUrl: undefined },
      );
      const args = getLastBuildSessionArgs();
      expect(args.apiKey).toBe('phx_from_signup');
    });

    test('forwards --name to provisionNewAccount', async () => {
      mockProvisionNewAccountCli.mockResolvedValue(successResult);
      await runCISignup(['--name', 'Test User']);
      expect(mockProvisionNewAccountCli).toHaveBeenCalledWith(
        'new@example.com',
        'Test User',
        'US',
        { baseUrl: undefined },
      );
    });

    test('uppercases --region before provisioning', async () => {
      mockProvisionNewAccountCli.mockResolvedValue(successResult);
      await runCISignup(['--region', 'eu']);
      expect(mockProvisionNewAccountCli).toHaveBeenCalledWith(
        'new@example.com',
        '',
        'EU',
        { baseUrl: undefined },
      );
    });

    test('exits non-zero when provisioning rejects', async () => {
      mockProvisionNewAccountCli.mockRejectedValue(new Error('network fail'));
      await runCISignup();
      expect(mockProvisionNewAccountCli).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(1);
      expect(mockRunHeadlessCli).not.toHaveBeenCalled();
    });

    test('exits non-zero when provisioning returns no personal API key', async () => {
      mockProvisionNewAccountCli.mockResolvedValue({
        ...successResult,
        personalApiKey: undefined,
      });
      await runCISignup();
      expect(process.exit).toHaveBeenCalledWith(1);
      expect(mockRunHeadlessCli).not.toHaveBeenCalled();
    });

    test('existing --api-key takes precedence over --signup', async () => {
      await runCLI([
        '--ci',
        '--signup',
        '--email',
        'new@example.com',
        '--api-key',
        'phx_existing',
        '--install-dir',
        '/tmp/test',
      ]);
      for (let i = 0; i < 3; i++) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      expect(mockProvisionNewAccountCli).not.toHaveBeenCalled();
      const args = getLastBuildSessionArgs();
      expect(args.apiKey).toBe('phx_existing');
    });
  });
});
