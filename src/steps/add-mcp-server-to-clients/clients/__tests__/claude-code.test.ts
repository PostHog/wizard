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
});
