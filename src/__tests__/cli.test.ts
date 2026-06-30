// Mock functions are created via vi.hoisted so they exist before the hoisted
// vi.mock factories that reference them run.
// NOTE: variable names must be unique across test files because .test.ts
// files without top-level imports/exports share a single TS project scope.
const { mockBuildSessionCli, mockProvisionNewAccountCli } = vi.hoisted(() => ({
  mockBuildSessionCli: vi.fn((args: Record<string, unknown>) => args),
  mockProvisionNewAccountCli: vi.fn(),
}));

// Headless-only machinery, stubbed so the headless path doesn't construct a
// real WizardStore (which would re-call the mocked buildSession) or open a real
// network stream. The spies assert the stream is wired in headless and not CI.
const { mockStreamAttach, mockStreamShutdown } = vi.hoisted(() => ({
  mockStreamAttach: vi.fn(),
  mockStreamShutdown: vi.fn(),
}));
vi.mock('../lib/task-stream/index', () => ({
  // shutdown() hardcodes a resolved Promise (not a bare vi.fn) so the
  // interactive runWizard's dangling SIGTERM handler — which calls
  // shutdown().catch() and outlives these tests — never hits undefined.catch.
  TaskStreamPush: class {
    attach() {
      mockStreamAttach();
    }
    shutdown() {
      mockStreamShutdown();
      return Promise.resolve();
    }
  },
  PostHogDestination: class {},
}));
vi.mock('../ui/tui/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ui/tui/store')>()),
  WizardStore: class {
    session: unknown;
    setRunPhase = vi.fn();
    setOutroData = vi.fn();
    syncTodos = vi.fn();
  },
}));

vi.mock('semver', () => ({ satisfies: () => true }));
// importOriginal keeps real exports (e.g. RunPhase) while overriding
// buildSession — vitest throws on access to exports a partial mock omits.
vi.mock('../lib/wizard-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/wizard-session')>()),
  buildSession: mockBuildSessionCli,
}));
vi.mock('../utils/provisioning', () => ({
  provisionNewAccount: mockProvisionNewAccountCli,
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
// CI-path dynamic imports need mocks to prevent unhandled rejections
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

describe('CLI argument parsing', () => {
  const originalArgv = process.argv;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalExit = process.exit;

  // The wizard's env vars that individual tests set. Cleared around each test
  // by mutating the live process.env in place — reassigning `process.env` to a
  // fresh object (as this used to) defeats yargs' `.env()` reader once the
  // module graph has been reset and yargs re-imported, so env-only flags stop
  // being picked up.
  const WIZARD_ENV_KEYS = [
    'POSTHOG_WIZARD_REGION',
    'POSTHOG_WIZARD_DEFAULT',
    'POSTHOG_WIZARD_CI',
    'POSTHOG_WIZARD_API_KEY',
    'POSTHOG_WIZARD_INSTALL_DIR',
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
      // vi.resetModules() (afterEach) clears the registry, so this re-evaluates
      // bin.ts fresh on every call — the vitest equivalent of isolateModules.
      await import('../../bin');
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
    // buildSession (success paths) or process.exit (validation-failure paths).
    // This guarantees the run has acted before we return, so it can't leak a
    // first sink call into the next test.
    // Poll on a real timer (not a fixed event-loop-turn count): afterEach's
    // vi.resetModules() forces a full graph reload from disk on every run, so
    // the chain is I/O-bound and can be starved when vitest runs files in
    // parallel. A wall-clock budget tolerates that load; it returns as soon as
    // the sink fires, so the budget is only spent in the worst case.
    const sank = () =>
      mockBuildSessionCli.mock.calls.length > 0 ||
      (process.exit as unknown as Mock).mock.calls.length > 0;
    for (let i = 0; i < 300 && !sank(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    // Then drain: process.exit is a no-op here, so a validation-failure chain
    // keeps running past it and may still call buildSession. A short wait lets
    // that trailing work finish inside this test rather than leaking into the
    // next one. (Success chains past their sink only park on the never-resolving
    // intro gate or hit mocked no-ops.)
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  /**
   * Helper to get the arguments passed to the last buildSession call.
   * buildSession is the common interception point for both CI and non-CI paths.
   */
  function getLastBuildSessionArgs() {
    expect(mockBuildSessionCli).toHaveBeenCalled();
    const calls = mockBuildSessionCli.mock.calls;
    return calls[calls.length - 1][0];
  }

  // Note: --region is a yargs option that doesn't flow through buildSession in
  // the non-CI path, so it's tested indirectly (no errors) rather than by
  // inspecting values.

  describe('--region flag', () => {
    test.each(['us', 'eu'])(
      'accepts "%s" as a valid region',
      async (region) => {
        await runCLI(['--region', region]);
        expect(mockBuildSessionCli).toHaveBeenCalled();
      },
    );
  });

  describe('environment variables', () => {
    test('respects POSTHOG_WIZARD_REGION', async () => {
      process.env.POSTHOG_WIZARD_REGION = 'eu';

      await runCLI([]);

      expect(mockBuildSessionCli).toHaveBeenCalled();
    });

    test('CLI args override environment variables', async () => {
      process.env.POSTHOG_WIZARD_REGION = 'us';

      await runCLI(['--region', 'eu']);

      expect(mockBuildSessionCli).toHaveBeenCalled();
    });
  });

  describe('backward compatibility', () => {
    test('all existing flags continue to work', async () => {
      await runCLI(['--debug', '--signup', '--install-dir', '/custom/path']);

      const args = getLastBuildSessionArgs();

      // Existing flags forwarded through buildSession
      expect(args.debug).toBe(true);
      expect(args.signup).toBe(true);
      expect(args.installDir).toBe('/custom/path');
    });
  });

  // MCP commands now launch TUI — tested via integration tests

  describe('--ci flag', () => {
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

    test('passes --api-key through to buildSession', async () => {
      await runCLI([
        '--ci',
        '--region',
        'us',
        '--api-key',
        'phx_test_key',
        '--install-dir',
        '/tmp/test',
      ]);

      const args = getLastBuildSessionArgs();
      expect(args.apiKey).toBe('phx_test_key');
    });

    test("tags the build as 'ci'", async () => {
      await runCLI([
        '--ci',
        '--api-key',
        'phx_test',
        '--install-dir',
        '/tmp/test',
      ]);

      const { analytics } = await import('../utils/analytics');
      expect(analytics.setTag).toHaveBeenCalledWith('build', 'ci');
    });

    test('does not stream wizard-session state in CI', async () => {
      await runCLI([
        '--ci',
        '--api-key',
        'phx_test',
        '--install-dir',
        '/tmp/test',
      ]);

      expect(mockStreamAttach).not.toHaveBeenCalled();
    });
  });

  // The experimental headless flag is the published-build sibling of --ci: it
  // routes through the same non-interactive runner (session.ci === true), but
  // is its own flag and tags the build distinctly so the two modes segment in
  // analytics. Its CLI name is intentionally ugly/undocumented — sourced from
  // @lib/headless-mode so this test never has to spell it out.
  describe('headless flag', () => {
    // Source of truth: HEADLESS_FLAG in src/lib/headless-mode.ts. Hardcoded
    // here (not imported) to keep this file free of top-level imports — see the
    // note at the top of the file.
    const headlessFlag = '--headless-DONOTUSE-EXPERIMENTAL';

    test('routes through the CI runner (builds a ci session)', async () => {
      await runCLI([
        headlessFlag,
        '--api-key',
        'pha_test',
        '--install-dir',
        '/tmp/test',
      ]);

      const args = getLastBuildSessionArgs();
      expect(args.ci).toBe(true);
    });

    test("tags the build as 'headless' (not 'ci')", async () => {
      await runCLI([
        headlessFlag,
        '--api-key',
        'pha_test',
        '--install-dir',
        '/tmp/test',
      ]);

      const { analytics } = await import('../utils/analytics');
      expect(analytics.setTag).toHaveBeenCalledWith('build', 'headless');
      expect(analytics.setTag).not.toHaveBeenCalledWith('build', 'ci');
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

      const { analytics } = await import('../utils/analytics');
      expect(analytics.setTag).toHaveBeenCalledWith('build', 'headless');
      expect(analytics.setTag).not.toHaveBeenCalledWith('build', 'ci');
    });

    test('attaches and flushes the wizard-session stream', async () => {
      await runCLI([
        headlessFlag,
        '--api-key',
        'pha_test',
        '--install-dir',
        '/tmp/test',
      ]);

      expect(mockStreamAttach).toHaveBeenCalled();
      expect(mockStreamShutdown).toHaveBeenCalled();
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
      // Let the async provisioning IIFE + runWizardCI's own IIFE settle
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
      expect(mockBuildSessionCli).not.toHaveBeenCalled();
    });

    test('exits non-zero when provisioning returns no personal API key', async () => {
      mockProvisionNewAccountCli.mockResolvedValue({
        ...successResult,
        personalApiKey: undefined,
      });
      await runCISignup();
      expect(process.exit).toHaveBeenCalledWith(1);
      expect(mockBuildSessionCli).not.toHaveBeenCalled();
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
