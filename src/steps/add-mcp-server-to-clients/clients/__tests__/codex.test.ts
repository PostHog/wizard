import { CodexMCPClient } from '../codex';
import { getDefaultServerConfig } from '../../defaults';

jest.mock('node:child_process', () => ({
  execSync: jest.fn(),
  spawnSync: jest.fn(),
}));

jest.mock('../../defaults', () => ({
  getDefaultServerConfig: jest.fn(),
}));

jest.mock('../../../../utils/analytics', () => ({
  analytics: {
    captureException: jest.fn(),
  },
}));

describe('CodexMCPClient', () => {
  const { execSync, spawnSync } = require('node:child_process');
  const analytics = require('../../../../utils/analytics').analytics;
  const getDefaultServerConfigMock = getDefaultServerConfig as jest.Mock;

  const spawnSyncMock = spawnSync as jest.Mock;
  const execSyncMock = execSync as jest.Mock;

  const mockConfig = {
    command: 'npx',
    args: ['-y', 'mcp-remote@latest', 'https://example.com'],
    env: {
      POSTHOG_AUTH_HEADER: 'Bearer phx_example',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    getDefaultServerConfigMock.mockReturnValue(mockConfig);
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
    it('invokes codex mcp add with expected arguments', async () => {
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
          '--env',
          'POSTHOG_AUTH_HEADER=Bearer phx_example',
          '--',
          'npx',
          '-y',
          'mcp-remote@latest',
          'https://example.com',
        ],
        { stdio: 'ignore' },
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
