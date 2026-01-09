// Mock functions must be defined before imports
const mockRunWizard = jest.fn();
const mockRunMCPInstall = jest.fn();
const mockRunMCPRemove = jest.fn();

jest.mock('../run', () => ({ runWizard: mockRunWizard }));
jest.mock('../mcp', () => ({
  runMCPInstall: mockRunMCPInstall,
  runMCPRemove: mockRunMCPRemove,
}));
jest.mock('semver', () => ({ satisfies: () => true }));

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

    // Mock process.exit to prevent test runner from exiting
    process.exit = jest.fn() as any;
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

    jest.isolateModules(() => {
      require('../../bin.ts');
    });

    // Allow yargs to process
    await new Promise((resolve) => setImmediate(resolve));
  }

  /**
   * Helper to get the arguments passed to a mock function
   */
  function getLastCallArgs(mockFn: jest.Mock) {
    expect(mockFn).toHaveBeenCalled();
    return mockFn.mock.calls[mockFn.mock.calls.length - 1][0];
  }

  describe('--default flag', () => {
    test('defaults to true when not specified', async () => {
      await runCLI([]);

      const args = getLastCallArgs(mockRunWizard);
      expect(args.default).toBe(true);
    });

    test('can be explicitly set to false with --no-default', async () => {
      await runCLI(['--no-default']);

      const args = getLastCallArgs(mockRunWizard);
      expect(args.default).toBe(false);
    });

    test('can be explicitly set to true', async () => {
      await runCLI(['--default']);

      const args = getLastCallArgs(mockRunWizard);
      expect(args.default).toBe(true);
    });
  });

  describe('--region flag', () => {
    test('is undefined when not specified', async () => {
      await runCLI([]);

      const args = getLastCallArgs(mockRunWizard);
      expect(args.region).toBeUndefined();
    });

    test.each(['us', 'eu'])(
      'accepts "%s" as a valid region',
      async (region) => {
        await runCLI(['--region', region]);

        const args = getLastCallArgs(mockRunWizard);
        expect(args.region).toBe(region);
      },
    );
  });

  describe('environment variables', () => {
    test('respects POSTHOG_WIZARD_REGION', async () => {
      process.env.POSTHOG_WIZARD_REGION = 'eu';

      await runCLI([]);

      const args = getLastCallArgs(mockRunWizard);
      expect(args.region).toBe('eu');
    });

    test('respects POSTHOG_WIZARD_DEFAULT', async () => {
      process.env.POSTHOG_WIZARD_DEFAULT = 'false';

      await runCLI([]);

      const args = getLastCallArgs(mockRunWizard);
      expect(args.default).toBe(false);
    });

    test('CLI args override environment variables', async () => {
      process.env.POSTHOG_WIZARD_REGION = 'us';
      process.env.POSTHOG_WIZARD_DEFAULT = 'false';

      await runCLI(['--region', 'eu', '--default']);

      const args = getLastCallArgs(mockRunWizard);
      expect(args.region).toBe('eu');
      expect(args.default).toBe(true);
    });

    test('region is undefined when no env var or CLI arg', async () => {
      await runCLI([]);

      const args = getLastCallArgs(mockRunWizard);
      expect(args.region).toBeUndefined();
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

      const args = getLastCallArgs(mockRunWizard);

      // Existing flags
      expect(args.debug).toBe(true);
      expect(args.signup).toBe(true);
      expect(args['force-install']).toBe(true);
      expect(args['install-dir']).toBe('/custom/path');
      expect(args.integration).toBe('nextjs');

      // New defaults
      expect(args.default).toBe(true);
      expect(args.region).toBeUndefined();
    });
  });

  describe('mcp commands', () => {
    test('mcp add region is undefined when not specified', async () => {
      await runCLI(['mcp', 'add']);

      const args = getLastCallArgs(mockRunMCPInstall);
      expect(args.region).toBeUndefined();
    });

    test('mcp add respects --region flag', async () => {
      await runCLI(['mcp', 'add', '--region', 'eu']);

      const args = getLastCallArgs(mockRunMCPInstall);
      expect(args.region).toBe('eu');
    });

    test('mcp commands inherit global flags', async () => {
      await runCLI(['mcp', 'add', '--no-default', '--debug']);

      const args = getLastCallArgs(mockRunMCPInstall);
      expect(args.default).toBe(false);
      expect(args.debug).toBe(true);
    });
  });

  describe('--ci flag', () => {
    test('defaults to false when not specified', async () => {
      await runCLI([]);

      const args = getLastCallArgs(mockRunWizard);
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

      const args = getLastCallArgs(mockRunWizard);
      expect(args.ci).toBe(true);
    });

    test('requires --region when --ci is set', async () => {
      await runCLI([
        '--ci',
        '--api-key',
        'phx_test',
        '--install-dir',
        '/tmp/test',
      ]);

      expect(process.exit).toHaveBeenCalledWith(1);
    });

    test('requires --api-key when --ci is set', async () => {
      await runCLI(['--ci', '--region', 'us', '--install-dir', '/tmp/test']);

      expect(process.exit).toHaveBeenCalledWith(1);
    });

    test('requires --install-dir when --ci is set', async () => {
      await runCLI(['--ci', '--region', 'us', '--api-key', 'phx_test']);

      expect(process.exit).toHaveBeenCalledWith(1);
    });

    test('passes --api-key to runWizard', async () => {
      await runCLI([
        '--ci',
        '--region',
        'us',
        '--api-key',
        'phx_test_key',
        '--install-dir',
        '/tmp/test',
      ]);

      const args = getLastCallArgs(mockRunWizard);
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

      const args = getLastCallArgs(mockRunWizard);
      expect(args.ci).toBe(true);
    });

    test('respects POSTHOG_WIZARD_API_KEY', async () => {
      process.env.POSTHOG_WIZARD_CI = 'true';
      process.env.POSTHOG_WIZARD_REGION = 'eu';
      process.env.POSTHOG_WIZARD_API_KEY = 'phx_env_key';
      process.env.POSTHOG_WIZARD_INSTALL_DIR = '/tmp/test';

      await runCLI([]);

      const args = getLastCallArgs(mockRunWizard);
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

      const args = getLastCallArgs(mockRunWizard);
      expect(args.region).toBe('eu');
      expect(args.apiKey).toBe('phx_cli_key');
    });
  });
});
