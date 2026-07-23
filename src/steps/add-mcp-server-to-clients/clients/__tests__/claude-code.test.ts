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

  describe('isServerInstalled', () => {
    // `claude mcp list` enumerates servers across all scopes as `<name>: <url>`.
    const listOutput = (...names: string[]) =>
      Buffer.from(
        names
          .map((n) => `${n}: https://mcp.example.com/ - ✓ Connected`)
          .join('\n') + '\n',
      );

    const mockList = (output: Buffer) =>
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'command -v claude') return Buffer.from('');
        if (String(cmd).includes('mcp list')) return output;
        return Buffer.from('');
      });

    it('returns true when the exact server name is present', async () => {
      mockList(listOutput('posthog'));
      const client = new ClaudeCodeMCPClient();
      await expect(client.isServerInstalled()).resolves.toBe(true);
    });

    it('does not match posthog-local when checking for posthog', async () => {
      mockList(listOutput('posthog-local'));
      const client = new ClaudeCodeMCPClient();
      await expect(client.isServerInstalled(false)).resolves.toBe(false);
    });

    it('does not match posthog when checking for posthog-local', async () => {
      mockList(listOutput('posthog'));
      const client = new ClaudeCodeMCPClient();
      await expect(client.isServerInstalled(true)).resolves.toBe(false);
    });

    it('matches posthog-local when requested', async () => {
      mockList(listOutput('posthog', 'posthog-local'));
      const client = new ClaudeCodeMCPClient();
      await expect(client.isServerInstalled(true)).resolves.toBe(true);
    });

    it('returns false when mcp list throws', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'command -v claude') return Buffer.from('');
        throw new Error('command failed');
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.isServerInstalled()).resolves.toBe(false);
    });
  });

  describe('removeServer', () => {
    it('returns success on exit 0', async () => {
      execSyncMock.mockImplementation(() => Buffer.from(''));
      const client = new ClaudeCodeMCPClient();
      await expect(client.removeServer()).resolves.toEqual({ success: true });
    });

    it('treats "No user-scoped MCP server found" stderr as a benign no-op', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'command -v claude') return Buffer.from('');
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

    it('treats "No MCP server named ... in user scope" stderr as a benign no-op', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'command -v claude') return Buffer.from('');
        if (String(cmd).includes('mcp remove')) {
          throw new Error(
            'Command failed: claude mcp remove --scope user posthog\nNo MCP server named "posthog" in user scope',
          );
        }
        return Buffer.from('');
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.removeServer()).resolves.toEqual({ success: true });
      expect(analytics.captureException).not.toHaveBeenCalled();
    });

    it('returns failure and captures exception on unexpected error', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'command -v claude') return Buffer.from('');
        if (String(cmd).includes('mcp remove')) {
          throw new Error('spawn ENOENT');
        }
        return Buffer.from('');
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.removeServer()).resolves.toEqual({ success: false });
      expect(analytics.captureException).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('spawn ENOENT'),
        }),
      );
    });

    it('returns failure when no binary is found', async () => {
      execSyncMock.mockImplementation(() => {
        throw new Error('not found');
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.removeServer()).resolves.toEqual({ success: false });
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
});
