import { ClaudeCodeMCPClient } from '@steps/add-mcp-server-to-clients/clients/claude-code';
import { execSync } from 'child_process';
import * as os from 'os';
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
    /** Every `claude` invocation made during the call, in order. */
    const claudeCalls = () =>
      execSyncMock.mock.calls
        .map(([cmd]) => String(cmd))
        .filter((cmd) => cmd !== 'command -v claude');

    it('registers the marketplace before installing when it is not configured', async () => {
      execSyncMock.mockImplementation(() => Buffer.from(''));
      const client = new ClaudeCodeMCPClient();

      await expect(client.installPlugin()).resolves.toEqual({ success: true });

      expect(claudeCalls()).toEqual([
        'claude "plugin" "marketplace" "list"',
        'claude "plugin" "marketplace" "add" "anthropics/claude-plugins-official"',
        'claude "plugin" "install" "posthog@claude-plugins-official"',
      ]);
    });

    it('skips the marketplace add when it is already configured', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (String(cmd).includes('marketplace" "list'))
          return Buffer.from('claude-plugins-official  github\n');
        return Buffer.from('');
      });
      const client = new ClaudeCodeMCPClient();

      await expect(client.installPlugin()).resolves.toEqual({ success: true });

      expect(claudeCalls()).toEqual([
        'claude "plugin" "marketplace" "list"',
        'claude "plugin" "install" "posthog@claude-plugins-official"',
      ]);
    });

    it('refreshes a stale marketplace and retries when the plugin is not found', async () => {
      let installAttempts = 0;
      execSyncMock.mockImplementation((cmd: string) => {
        if (String(cmd).includes('"install"')) {
          installAttempts += 1;
          if (installAttempts === 1) {
            throw new Error(
              'Failed to install plugin "posthog": Plugin "posthog" not found in any configured marketplace',
            );
          }
        }
        return Buffer.from('');
      });
      const client = new ClaudeCodeMCPClient();

      await expect(client.installPlugin()).resolves.toEqual({ success: true });

      expect(claudeCalls()).toContain(
        'claude "plugin" "marketplace" "update" "claude-plugins-official"',
      );
      expect(installAttempts).toBe(2);
      expect(analytics.captureException).not.toHaveBeenCalled();
    });

    it('falls back to the bare plugin name when the qualified one stays unresolvable', async () => {
      const attempts: string[] = [];
      execSyncMock.mockImplementation((cmd: string) => {
        if (String(cmd).includes('"install"')) {
          attempts.push(String(cmd));
          if (String(cmd).includes('posthog@')) {
            throw new Error(
              'Plugin "posthog" not found in any configured marketplace',
            );
          }
        }
        return Buffer.from('');
      });
      const client = new ClaudeCodeMCPClient();

      await expect(client.installPlugin()).resolves.toEqual({ success: true });

      expect(attempts.at(-1)).toBe('claude "plugin" "install" "posthog"');
      expect(analytics.captureException).not.toHaveBeenCalled();
    });

    it.each(['already installed', 'already exists'])(
      'returns alreadyInstalled when the CLI reports "%s"',
      async (message) => {
        execSyncMock.mockImplementation((cmd: string) => {
          if (String(cmd).includes('"install"')) throw new Error(message);
          return Buffer.from('');
        });
        const client = new ClaudeCodeMCPClient();
        await expect(client.installPlugin()).resolves.toEqual({
          success: true,
          alreadyInstalled: true,
        });
      },
    );

    it.each([
      ["error: unknown command 'install'", 'too old'],
      ['Invalid schema: plugins.0.source: Invalid input', "couldn't read"],
      ['spawnSync /bin/sh ENOBUFS', 'ran out of room'],
      ['Failed to clone repository: No ED25519 host key is known', 'GitHub'],
      ['EACCES: permission denied', 'permissions'],
    ])(
      'treats %j as an expected local failure and hints instead of reporting',
      async (stderr, hintFragment) => {
        execSyncMock.mockImplementation((cmd: string) => {
          if (String(cmd).includes('"install"')) throw new Error(stderr);
          return Buffer.from('');
        });
        const client = new ClaudeCodeMCPClient();

        const result = await client.installPlugin();

        expect(result.success).toBe(false);
        expect(result.hint).toContain(hintFragment);
        expect(analytics.captureException).not.toHaveBeenCalled();
      },
    );

    it('reports unexpected failures under a stable message with the detail in properties', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (String(cmd).includes('"install"')) {
          const err = new Error(
            'Command failed: claude plugin install',
          ) as Error & { stderr: string };
          err.stderr = `✘ Failed to install plugin: something odd at ${os.homedir()}/.claude`;
          throw err;
        }
        return Buffer.from('');
      });
      const client = new ClaudeCodeMCPClient();

      const result = await client.installPlugin();

      expect(result.success).toBe(false);
      expect(result.hint).toBeTruthy();
      expect(analytics.captureException).toHaveBeenCalledTimes(1);
      const [error, properties] = (analytics.captureException as Mock).mock
        .calls[0] as [Error, Record<string, unknown>];
      // Stable title — no stderr, no binary path, so one root cause is one issue.
      expect(error.message).toBe('Claude Code plugin install failed (install)');
      expect(properties.stage).toBe('install');
      expect(properties.binary).toBe('claude');
      expect(properties.details).toContain('something odd');
      // Home directory normalised away.
      expect(properties.details).not.toContain(os.homedir());
      expect(properties.details).toContain('~/.claude');
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
