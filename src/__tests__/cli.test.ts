// Mock functions must be defined before imports (jest hoists jest.mock calls;
// variables starting with "mock" are allowed in the factory scope).
const mockBuildSession = jest.fn((args: Record<string, unknown>) => args);

jest.mock('semver', () => ({ satisfies: () => true }));
jest.mock('../lib/wizard-session', () => ({
  buildSession: mockBuildSession,
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
    delete process.env.POSTHOG_WIZARD_REGION;
    delete process.env.POSTHOG_WIZARD_DEFAULT;
    delete process.env.POSTHOG_WIZARD_CI;
    delete process.env.POSTHOG_WIZARD_API_KEY;
    delete process.env.POSTHOG_WIZARD_INSTALL_DIR;

    // Mock process.exit to prevent test runner from exiting.
    // Throwing stops the handler from continuing past validation failures
    // (e.g. into the CI async IIFE that expects validated options).
    process.exit = jest.fn().mockImplementation(() => {
      throw new Error('process.exit');
    }) as any;
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
    expect(mockBuildSession).toHaveBeenCalled();
    const calls = mockBuildSession.mock.calls;
    return calls[calls.length - 1][0];
  }

  // Note: --default and --region are yargs options that don't flow through
  // buildSession in the non-CI path, so they're tested indirectly (no errors)
  // rather than by inspecting values.

  describe('--default flag', () => {
    test('accepted when not specified', async () => {
      await runCLI([]);
      expect(mockBuildSession).toHaveBeenCalled();
    });

    test('accepted with --no-default', async () => {
      await runCLI(['--no-default']);
      expect(mockBuildSession).toHaveBeenCalled();
    });

    test('accepted when explicitly set to true', async () => {
      await runCLI(['--default']);
      expect(mockBuildSession).toHaveBeenCalled();
    });
  });

  describe('--region flag', () => {
    test.each(['us', 'eu'])(
      'accepts "%s" as a valid region',
      async (region) => {
        await runCLI(['--region', region]);
        expect(mockBuildSession).toHaveBeenCalled();
      },
    );
  });

  describe('environment variables', () => {
    test('respects POSTHOG_WIZARD_REGION', async () => {
      process.env.POSTHOG_WIZARD_REGION = 'eu';

      await runCLI([]);

      expect(mockBuildSession).toHaveBeenCalled();
    });

    test('respects POSTHOG_WIZARD_DEFAULT', async () => {
      process.env.POSTHOG_WIZARD_DEFAULT = 'false';

      await runCLI([]);

      expect(mockBuildSession).toHaveBeenCalled();
    });

    test('CLI args override environment variables', async () => {
      process.env.POSTHOG_WIZARD_REGION = 'us';
      process.env.POSTHOG_WIZARD_DEFAULT = 'false';

      await runCLI(['--region', 'eu', '--default']);

      expect(mockBuildSession).toHaveBeenCalled();
    });
  });

  describe('backward compatibility', () => {
    test('all existing flags continue to work', async () => {
      await runCLI([
        '--debug',
        '--signup',
        '--force-install',
        '--install-dir',
        '/custom/path',
        '--integration',
        'nextjs',
      ]);

      const args = getLastBuildSessionArgs();

      // Existing flags forwarded through buildSession
      expect(args.debug).toBe(true);
      expect(args.signup).toBe(true);
      expect(args.forceInstall).toBe(true);
      expect(args.installDir).toBe('/custom/path');
      expect(args.integration).toBe('nextjs');
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
});
