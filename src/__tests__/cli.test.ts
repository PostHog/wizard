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
    test('defaults to "us" when not specified', async () => {
      await runCLI([]);

      const args = getLastCallArgs(mockRunWizard);
      expect(args.region).toBe('us');
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

  describe('--eu flag (shorthand for --region eu)', () => {
    test('sets region to "eu"', async () => {
      await runCLI(['--eu']);

      const args = getLastCallArgs(mockRunWizard);
      expect(args.region).toBe('eu');
      expect(args.eu).toBe(true);
    });

    test('overrides --region flag when both are specified', async () => {
      await runCLI(['--region', 'us', '--eu']);

      const args = getLastCallArgs(mockRunWizard);
      expect(args.region).toBe('eu');
    });

    test('overrides --region flag regardless of order', async () => {
      await runCLI(['--eu', '--region', 'us']);

      const args = getLastCallArgs(mockRunWizard);
      expect(args.region).toBe('eu');
    });
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
      expect(args.region).toBe('us');
    });
  });

  describe('mcp commands', () => {
    test('mcp add respects --eu flag', async () => {
      await runCLI(['mcp', 'add', '--eu']);

      const args = getLastCallArgs(mockRunMCPInstall);
      expect(args.region).toBe('eu');
    });

    test('mcp add uses default region when not specified', async () => {
      await runCLI(['mcp', 'add']);

      const args = getLastCallArgs(mockRunMCPInstall);
      expect(args.region).toBe('us');
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
});
