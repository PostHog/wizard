import { CodexMCPClient } from '../codex';

jest.mock('node:child_process', () => ({
  execSync: jest.fn(),
  spawnSync: jest.fn(),
}));

jest.mock('../../../../utils/analytics', () => ({
  analytics: {
    captureException: jest.fn(),
  },
}));

describe('CodexMCPClient', () => {
  const { execSync, spawnSync } = require('node:child_process');
  const analytics = require('../../../../utils/analytics').analytics;

  const spawnSyncMock = spawnSync as jest.Mock;
  const execSyncMock = execSync as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isClientSupported', () => {
    it('returns true when codex binary is available', async () => {
      execSyncMock.mockReturnValue(undefined);

      const client = new CodexMCPClient();
      await expect(client.isClientSupported()).resolves.toBe(true);
      expect(execSyncMock).toHaveBeenCalledWith('codex --version', {
        stdio: 'ignore',
      });
    });

    it('returns false when codex binary is missing', async () => {
      execSyncMock.mockImplementation(() => {
        throw new Error('not found');
      });

      const client = new CodexMCPClient();
      await expect(client.isClientSupported()).resolves.toBe(false);
    });
  });

  describe('isServerInstalled', () => {
    it('returns true when posthog server exists', async () => {
      spawnSyncMock.mockReturnValue({
        status: 0,
        stdout: JSON.stringify([{ name: 'posthog' }, { name: 'other' }]),
      });

      const client = new CodexMCPClient();
      await expect(client.isServerInstalled()).resolves.toBe(true);
    });

    it('returns false when command fails', async () => {
      spawnSyncMock.mockReturnValue({ status: 1, stdout: '' });

      const client = new CodexMCPClient();
      await expect(client.isServerInstalled()).resolves.toBe(false);
    });
  });

  describe('addServer', () => {
    it('invokes codex mcp add with --url and --bearer-token-env-var', async () => {
      spawnSyncMock.mockReturnValue({ status: 0 });

      const client = new CodexMCPClient();
      const result = await client.addServer('phx_example');

      expect(result).toEqual({ success: true });
      expect(spawnSyncMock).toHaveBeenCalledWith(
        'codex',
        [
          'mcp',
          'add',
          'posthog',
          '--url',
          'https://mcp.posthog.com/mcp',
          '--bearer-token-env-var',
          'POSTHOG_API_KEY',
        ],
        expect.objectContaining({
          stdio: 'ignore',
          env: expect.objectContaining({
            POSTHOG_API_KEY: 'phx_example',
          }),
        }),
      );
    });

    it('omits auth in OAuth mode', async () => {
      spawnSyncMock.mockReturnValue({ status: 0 });

      const client = new CodexMCPClient();
      const result = await client.addServer(undefined);

      expect(result).toEqual({ success: true });
      expect(spawnSyncMock).toHaveBeenCalledWith(
        'codex',
        ['mcp', 'add', 'posthog', '--url', 'https://mcp.posthog.com/mcp'],
        expect.objectContaining({ stdio: 'ignore' }),
      );
    });

    it('returns false and captures exception on failure', async () => {
      spawnSyncMock.mockReturnValue({ status: 1 });

      const client = new CodexMCPClient();
      const result = await client.addServer('phx_example');

      expect(result).toEqual({ success: false });
      expect(analytics.captureException).toHaveBeenCalled();
    });
  });

  describe('removeServer', () => {
    it('invokes codex mcp remove and returns success', async () => {
      spawnSyncMock.mockReturnValue({ status: 0 });

      const client = new CodexMCPClient();
      const result = await client.removeServer();

      expect(result).toEqual({ success: true });
      expect(spawnSyncMock).toHaveBeenCalledWith(
        'codex',
        ['mcp', 'remove', 'posthog'],
        {
          stdio: 'ignore',
        },
      );
    });

    it('returns false and captures exception on failure', async () => {
      spawnSyncMock.mockReturnValue({ status: 1 });

      const client = new CodexMCPClient();
      const result = await client.removeServer();

      expect(result).toEqual({ success: false });
      expect(analytics.captureException).toHaveBeenCalled();
    });
  });
});
