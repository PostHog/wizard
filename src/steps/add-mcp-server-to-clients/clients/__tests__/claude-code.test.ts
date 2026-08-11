import { ClaudeCodeMCPClient } from '@steps/add-mcp-server-to-clients/clients/claude-code';
import { execSync } from 'child_process';
import { analytics } from '@utils/analytics';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
}));

vi.mock('../../../../utils/analytics', () => ({
  analytics: { captureException: vi.fn() },
}));

vi.mock('../../../../utils/debug', () => ({
  debug: vi.fn(),
}));

describe('ClaudeCodeMCPClient — plugin methods', () => {
  const execSyncMock = execSync as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
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
    it('uninstalls the plugin and treats "No user-scoped MCP server found" as a no-op (plugin present + MCP absent)', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'command -v claude') return Buffer.from('');
        if (String(cmd).includes('plugin list'))
          return Buffer.from('posthog  1.0.0\n');
        if (String(cmd).includes('plugin uninstall')) return Buffer.from('');
        if (String(cmd).includes('mcp remove'))
          throw new Error(
            'Command failed: claude mcp remove --scope user posthog\nNo user-scoped MCP server found with name: posthog',
          );
        return Buffer.from('');
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.removeServer()).resolves.toEqual({ success: true });
      expect(execSyncMock).toHaveBeenCalledWith(
        expect.stringContaining('plugin uninstall posthog'),
        expect.any(Object),
      );
      expect(analytics.captureException).not.toHaveBeenCalled();
    });

    it('removes the user-scoped MCP server when the plugin is not installed (MCP present + plugin absent)', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'command -v claude') return Buffer.from('');
        if (String(cmd).includes('plugin list'))
          return Buffer.from('other-plugin  2.0.0\n');
        if (String(cmd).includes('mcp remove')) return Buffer.from('');
        return Buffer.from('');
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.removeServer()).resolves.toEqual({ success: true });
      expect(execSyncMock).toHaveBeenCalledWith(
        expect.stringContaining('mcp remove --scope user posthog'),
        expect.any(Object),
      );
      expect(execSyncMock).not.toHaveBeenCalledWith(
        expect.stringContaining('plugin uninstall'),
        expect.any(Object),
      );
      expect(analytics.captureException).not.toHaveBeenCalled();
    });

    it('uses posthog-local as the server name when local=true', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'command -v claude') return Buffer.from('');
        if (String(cmd).includes('plugin list'))
          return Buffer.from('other-plugin\n');
        if (String(cmd).includes('mcp remove')) return Buffer.from('');
        return Buffer.from('');
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.removeServer(true)).resolves.toEqual({
        success: true,
      });
      expect(execSyncMock).toHaveBeenCalledWith(
        expect.stringContaining('mcp remove --scope user posthog-local'),
        expect.any(Object),
      );
    });

    it('captures an exception and returns success: false on unexpected mcp remove failure', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'command -v claude') return Buffer.from('');
        if (String(cmd).includes('plugin list'))
          return Buffer.from('other-plugin\n');
        if (String(cmd).includes('mcp remove'))
          throw new Error('something went wrong');
        return Buffer.from('');
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.removeServer()).resolves.toEqual({ success: false });
      expect(analytics.captureException).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('something went wrong'),
        }),
      );
    });

    it('captures an exception and returns success: false on unexpected plugin uninstall failure', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'command -v claude') return Buffer.from('');
        if (String(cmd).includes('plugin list'))
          return Buffer.from('posthog  1.0.0\n');
        if (String(cmd).includes('plugin uninstall'))
          throw new Error('network timeout');
        if (String(cmd).includes('mcp remove')) return Buffer.from('');
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

    it('returns success: false when no binary is found', async () => {
      execSyncMock.mockImplementation(() => {
        throw new Error('not found');
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.removeServer()).resolves.toEqual({ success: false });
    });
  });
});
