import { ClaudeCodeMCPClient } from '../claude-code';

jest.mock('child_process', () => ({
  execSync: jest.fn(),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
}));

jest.mock('../../../../utils/analytics', () => ({
  analytics: { captureException: jest.fn() },
}));

jest.mock('../../../../utils/debug', () => ({
  debug: jest.fn(),
}));

describe('ClaudeCodeMCPClient — plugin methods', () => {
  const { execSync } = require('child_process');
  const { analytics } = require('../../../../utils/analytics');
  const execSyncMock = execSync as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    // Make binary discoverable via PATH by default
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd === 'command -v claude') return Buffer.from('');
      return Buffer.from('');
    });
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
    it('returns success on exit 0', async () => {
      execSyncMock.mockImplementation(() => Buffer.from(''));
      const client = new ClaudeCodeMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({ success: true });
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

  describe('removeServer', () => {
    it('returns success when plugin uninstall succeeds and legacy entry is absent', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'command -v claude') return Buffer.from('');
        if (String(cmd).includes('plugin uninstall')) return Buffer.from('');
        if (String(cmd).includes('mcp remove')) {
          throw new Error(
            'Command failed: claude mcp remove --scope user posthog\nNo user-scoped MCP server found with name: posthog',
          );
        }
        return Buffer.from('');
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.removeServer()).resolves.toEqual({ success: true });
      expect(analytics.captureException).not.toHaveBeenCalled();
    });

    it('treats "No user-scoped MCP server found" as a successful no-op when plugin is also absent', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'command -v claude') return Buffer.from('');
        if (String(cmd).includes('plugin uninstall')) {
          throw new Error('Plugin "posthog" is not installed');
        }
        if (String(cmd).includes('mcp remove')) {
          throw new Error(
            'Command failed: claude mcp remove --scope user posthog\nNo user-scoped MCP server found with name: posthog',
          );
        }
        return Buffer.from('');
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.removeServer()).resolves.toEqual({ success: true });
      expect(analytics.captureException).not.toHaveBeenCalled();
    });

    it('cleans up legacy MCP entry when plugin was never installed', async () => {
      const calls: string[] = [];
      execSyncMock.mockImplementation((cmd: string) => {
        calls.push(String(cmd));
        if (cmd === 'command -v claude') return Buffer.from('');
        if (String(cmd).includes('plugin uninstall')) {
          throw new Error('Plugin "posthog" is not installed');
        }
        return Buffer.from('');
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.removeServer()).resolves.toEqual({ success: true });
      expect(
        calls.some((c) => c.includes('mcp remove --scope user posthog')),
      ).toBe(true);
      expect(analytics.captureException).not.toHaveBeenCalled();
    });

    it('uses posthog-local as the legacy server name when local=true', async () => {
      const calls: string[] = [];
      execSyncMock.mockImplementation((cmd: string) => {
        calls.push(String(cmd));
        if (cmd === 'command -v claude') return Buffer.from('');
        return Buffer.from('');
      });
      const client = new ClaudeCodeMCPClient();
      await client.removeServer(true);
      expect(
        calls.some((c) => c.includes('mcp remove --scope user posthog-local')),
      ).toBe(true);
    });

    it('returns failure and captures exception on a genuine plugin-uninstall error', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'command -v claude') return Buffer.from('');
        if (String(cmd).includes('plugin uninstall')) {
          throw new Error('network timeout');
        }
        return Buffer.from('');
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.removeServer()).resolves.toEqual({ success: false });
      expect(analytics.captureException).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('network timeout'),
        }),
      );
    });

    it('returns failure and captures exception on a genuine mcp-remove error', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'command -v claude') return Buffer.from('');
        if (String(cmd).includes('plugin uninstall')) return Buffer.from('');
        if (String(cmd).includes('mcp remove')) {
          throw new Error('unexpected CLI failure');
        }
        return Buffer.from('');
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.removeServer()).resolves.toEqual({ success: false });
      expect(analytics.captureException).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('unexpected CLI failure'),
        }),
      );
    });

    it('returns failure when no binary is found', async () => {
      execSyncMock.mockImplementation(() => {
        throw new Error('not found');
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.removeServer()).resolves.toEqual({ success: false });
      expect(analytics.captureException).not.toHaveBeenCalled();
    });
  });
});
