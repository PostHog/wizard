// Mock functions must be defined before imports (jest hoists jest.mock calls;
// variables starting with "mock" are allowed in the factory scope).
// NOTE: variable names must be unique across test files because .test.ts
// files without top-level imports/exports share a single TS project scope.
const mockBuildSessionCli = jest.fn((args: Record<string, unknown>) => args);
const mockProvisionNewAccountCli = jest.fn();

jest.mock('semver', () => ({ satisfies: () => true }));
jest.mock('../lib/wizard-session', () => ({
  buildSession: mockBuildSessionCli,
}));
jest.mock('../utils/provisioning', () => ({
  provisionNewAccount: mockProvisionNewAccountCli,
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
jest.mock('../lib/programs/posthog-integration/index', () => ({
  posthogIntegrationConfig: {
    id: 'posthog-integration',
    steps: [],
    run: null,
  },
}));
jest.mock('../utils/environment', () => ({
  isNonInteractiveEnvironment: () => false,
  readEnvironment: () => ({}),
}));
// CI-path dynamic imports need mocks to prevent unhandled rejections
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

describe('CLI argument parsing', () => {
  const originalArgv = process.argv;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalExit = process.exit;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset environment
    process.env = { ...originalEnv };
    delete process.env.WIZARD_REGION;
    delete process.env.WIZARD_DEFAULT;
    delete process.env.WIZARD_CI;
    delete process.env.WIZARD_API_KEY;
    delete process.env.WIZARD_INSTALL_DIR;

    // Mock process.exit so the test runner doesn't exit. The CLI dispatch is
    // async (it dynamically imports the matched command file), so a throwing
    // mock would escape as an unhandled rejection rather than halting the
    // handler. A no-op suffices: validation failures `return` right after
    // calling exit, and tests assert on the recorded exit code.
    process.exit = jest.fn() as unknown as typeof process.exit;
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exit = originalExit;
    process.env = originalEnv;
    jest.resetModules();
  });

  /**
   * Helper to run the CLI with given arguments
   */
  async function runCLI(args: string[]) {
    process.argv = ['node', 'bin.ts', ...args];

    try {
      jest.isolateModules(() => {
        require('../../bin.ts');
      });
    } catch {
      // process.exit mock throws to halt handler execution
    }

    // Allow yargs + async handlers to process
    await new Promise((resolve) => setImmediate(resolve));
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
    test('respects WIZARD_REGION', async () => {
      process.env.WIZARD_REGION = 'eu';

      await runCLI([]);

      expect(mockBuildSessionCli).toHaveBeenCalled();
    });

    test('CLI args override environment variables', async () => {
      process.env.WIZARD_REGION = 'us';

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
  });

  describe('CI environment variables', () => {
    test('respects WIZARD_CI', async () => {
      process.env.WIZARD_CI = 'true';
      process.env.WIZARD_REGION = 'us';
      process.env.WIZARD_API_KEY = 'phx_env_key';
      process.env.WIZARD_INSTALL_DIR = '/tmp/test';

      await runCLI([]);

      const args = getLastBuildSessionArgs();
      expect(args.ci).toBe(true);
    });

    test('respects WIZARD_API_KEY', async () => {
      process.env.WIZARD_CI = 'true';
      process.env.WIZARD_REGION = 'eu';
      process.env.WIZARD_API_KEY = 'phx_env_key';
      process.env.WIZARD_INSTALL_DIR = '/tmp/test';

      await runCLI([]);

      const args = getLastBuildSessionArgs();
      expect(args.apiKey).toBe('phx_env_key');
    });

    test('CLI args override CI environment variables', async () => {
      process.env.WIZARD_CI = 'true';
      process.env.WIZARD_REGION = 'us';
      process.env.WIZARD_API_KEY = 'phx_env_key';
      process.env.WIZARD_INSTALL_DIR = '/tmp/test';

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
      process.exit = jest.fn() as unknown as typeof process.exit;
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
      );
    });

    test('uppercases --region before provisioning', async () => {
      mockProvisionNewAccountCli.mockResolvedValue(successResult);
      await runCISignup(['--region', 'eu']);
      expect(mockProvisionNewAccountCli).toHaveBeenCalledWith(
        'new@example.com',
        '',
        'EU',
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
