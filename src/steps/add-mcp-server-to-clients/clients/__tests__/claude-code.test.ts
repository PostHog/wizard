import { ClaudeCodeMCPClient } from '../claude-code';

jest.mock('child_process', () => ({
  execSync: jest.fn(),
  spawnSync: jest.fn(),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  rmSync: jest.fn(),
}));

jest.mock('../../../../utils/analytics', () => ({
  analytics: { captureException: jest.fn() },
}));

jest.mock('../../../../utils/debug', () => ({
  debug: jest.fn(),
}));

describe('ClaudeCodeMCPClient — plugin methods', () => {
  const { execSync, spawnSync } = require('child_process');
  const fs = require('fs');
  const { analytics } = require('../../../../utils/analytics');
  const execSyncMock = execSync as jest.Mock;
  const spawnSyncMock = spawnSync as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    // Make binary discoverable via PATH by default
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd === 'command -v claude') return Buffer.from('');
      return Buffer.from('');
    });
    // Default: marketplace add succeeds
    spawnSyncMock.mockReturnValue({ status: 0, stderr: '' });
  });

  describe('supportsPlugin', () => {
    it('returns true when claude binary is found', () => {
      const client = new ClaudeCodeMCPClient();
      expect(client.supportsPlugin()).toBe(true);
    });

    it('returns false when no binary is found', () => {
      execSyncMock.mockImplementation(() => {
        throw new Error('not found');
      });
      const client = new ClaudeCodeMCPClient();
      expect(client.supportsPlugin()).toBe(false);
    });
  });

  describe('isPluginInstalled', () => {
    it('returns true when posthog appears in plugin list output', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'command -v claude') return Buffer.from('');
        if (String(cmd).includes('plugin list'))
          return Buffer.from('posthog  1.0.0\n');
        return Buffer.from('');
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.isPluginInstalled()).resolves.toBe(true);
    });

    it('returns false when posthog is absent from plugin list output', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'command -v claude') return Buffer.from('');
        if (String(cmd).includes('plugin list'))
          return Buffer.from('other-plugin  2.0.0\n');
        return Buffer.from('');
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.isPluginInstalled()).resolves.toBe(false);
    });

    it('returns false when plugin list command throws', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'command -v claude') return Buffer.from('');
        throw new Error('command failed');
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.isPluginInstalled()).resolves.toBe(false);
    });
  });

  describe('installPlugin', () => {
    it('registers the PostHog marketplace before installing the plugin', async () => {
      execSyncMock.mockImplementation(() => Buffer.from(''));
      const client = new ClaudeCodeMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({ success: true });
      expect(spawnSyncMock).toHaveBeenCalledWith(
        'claude',
        ['plugin', 'marketplace', 'add', 'PostHog/ai-plugin'],
        { encoding: 'utf-8' },
      );
      expect(execSyncMock).toHaveBeenCalledWith(
        'claude plugin install posthog',
        { stdio: 'pipe' },
      );
    });

    it('returns success on exit 0', async () => {
      execSyncMock.mockImplementation(() => Buffer.from(''));
      const client = new ClaudeCodeMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({ success: true });
    });

    it('continues to install when marketplace add reports already added', async () => {
      spawnSyncMock.mockReturnValue({
        status: 1,
        stderr: "marketplace 'posthog' already added",
      });
      execSyncMock.mockImplementation(() => Buffer.from(''));
      const client = new ClaudeCodeMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({ success: true });
      expect(execSyncMock).toHaveBeenCalledWith(
        'claude plugin install posthog',
        { stdio: 'pipe' },
      );
      expect(analytics.captureException).not.toHaveBeenCalled();
    });

    it('clears stale cache and retries when marketplace was already added from a different source', async () => {
      spawnSyncMock
        .mockReturnValueOnce({
          status: 1,
          stderr:
            "Error: marketplace 'posthog' is already added from a different source",
        })
        .mockReturnValueOnce({ status: 0, stderr: '' });
      execSyncMock.mockImplementation(() => Buffer.from(''));
      const client = new ClaudeCodeMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({ success: true });
      expect(fs.rmSync).toHaveBeenCalledWith(
        expect.stringContaining('marketplaces/posthog'),
        { recursive: true, force: true },
      );
      expect(spawnSyncMock).toHaveBeenCalledTimes(2);
    });

    it('surfaces a clearer message when the marketplace config file is corrupted', async () => {
      spawnSyncMock.mockReturnValue({
        status: 1,
        stderr:
          'Marketplace configuration file is corrupted: local.source.source: Invalid input',
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({ success: false });
      expect(analytics.captureException).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('marketplace config is corrupted'),
        }),
      );
      // Install must not run if the marketplace could not be registered
      expect(execSyncMock).not.toHaveBeenCalledWith(
        expect.stringContaining('plugin install'),
        expect.anything(),
      );
    });

    it('captures a marketplace add failure when stderr is some other error', async () => {
      spawnSyncMock.mockReturnValue({
        status: 1,
        stderr: 'network unreachable',
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({ success: false });
      expect(analytics.captureException).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining(
            'Claude Code marketplace add failed',
          ),
        }),
      );
    });

    it('returns success with alreadyInstalled when stderr contains "already installed"', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (String(cmd).includes('plugin install')) {
          throw new Error('already installed');
        }
        return Buffer.from('');
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({
        success: true,
        alreadyInstalled: true,
      });
    });

    it('returns success with alreadyInstalled when stderr contains "already exists"', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (String(cmd).includes('plugin install')) {
          throw new Error('already exists');
        }
        return Buffer.from('');
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({
        success: true,
        alreadyInstalled: true,
      });
    });

    it('returns failure and captures exception on unexpected error', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (String(cmd).includes('plugin install')) {
          throw new Error('network timeout');
        }
        return Buffer.from('');
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({ success: false });
      expect(analytics.captureException).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('network timeout'),
        }),
      );
    });

    it('returns failure when no binary is found', async () => {
      execSyncMock.mockImplementation(() => {
        throw new Error('not found');
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({ success: false });
    });
  });
});
