import { ClaudeCodeMCPClient } from '@steps/add-mcp-server-to-clients/clients/claude-code';

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
  const { analytics } = require('@utils/analytics');
  const execSyncMock = execSync as jest.Mock;

  // Default version returned by --version. Above MIN_PLUGIN_VERSION (1.0.88).
  const SUPPORTED_VERSION_OUTPUT = '1.0.123 (Claude Code)\n';

  // Wire up execSync with a handler that returns sane defaults for each
  // command the client may issue, plus a per-test override map for the
  // commands we want to control. `overrides` maps a substring of the
  // command to either a Buffer to return, or an Error to throw.
  function setupExec(overrides: Record<string, Buffer | Error> = {}): void {
    execSyncMock.mockImplementation((cmd: string) => {
      const str = String(cmd);
      for (const [substr, value] of Object.entries(overrides)) {
        if (str.includes(substr)) {
          if (value instanceof Error) throw value;
          return value;
        }
      }
      if (str === 'command -v claude') return Buffer.from('');
      if (str.includes('--version')) {
        return Buffer.from(SUPPORTED_VERSION_OUTPUT);
      }
      if (str.includes('plugin marketplace add')) return Buffer.from('');
      if (str.includes('plugin install')) return Buffer.from('');
      if (str.includes('plugin list')) return Buffer.from('');
      return Buffer.from('');
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    setupExec();
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
      setupExec({ 'plugin list': Buffer.from('posthog  1.0.0\n') });
      const client = new ClaudeCodeMCPClient();
      await expect(client.isPluginInstalled()).resolves.toBe(true);
    });

    it('returns false when posthog is absent from plugin list output', async () => {
      setupExec({ 'plugin list': Buffer.from('other-plugin  2.0.0\n') });
      const client = new ClaudeCodeMCPClient();
      await expect(client.isPluginInstalled()).resolves.toBe(false);
    });

    it('returns false when plugin list command throws', async () => {
      setupExec({ 'plugin list': new Error('command failed') });
      const client = new ClaudeCodeMCPClient();
      await expect(client.isPluginInstalled()).resolves.toBe(false);
    });
  });

  describe('installPlugin', () => {
    it('adds the PostHog marketplace then installs the plugin on success', async () => {
      const client = new ClaudeCodeMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({ success: true });

      const commands = execSyncMock.mock.calls.map((c) => String(c[0]));
      const marketplaceCall = commands.find((c) =>
        c.includes('plugin marketplace add'),
      );
      const installCall = commands.find((c) => c.includes('plugin install'));
      expect(marketplaceCall).toBeDefined();
      expect(marketplaceCall).toContain('PostHog/ai-plugin');
      expect(installCall).toBeDefined();
      expect(installCall).toMatch(/plugin install posthog/);
      // Marketplace registration must precede install.
      expect(commands.indexOf(marketplaceCall!)).toBeLessThan(
        commands.indexOf(installCall!),
      );
    });

    it('tolerates an "already added" marketplace and still installs', async () => {
      setupExec({
        'plugin marketplace add': new Error(
          "marketplace 'posthog' is already added",
        ),
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({ success: true });
      expect(analytics.captureException).not.toHaveBeenCalled();
    });

    it('returns success with alreadyInstalled when install reports "already installed"', async () => {
      setupExec({ 'plugin install': new Error('already installed') });
      const client = new ClaudeCodeMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({
        success: true,
        alreadyInstalled: true,
      });
    });

    it('returns success with alreadyInstalled when install reports "already exists"', async () => {
      setupExec({ 'plugin install': new Error('already exists') });
      const client = new ClaudeCodeMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({
        success: true,
        alreadyInstalled: true,
      });
    });

    it('returns unsupported (and skips marketplace add) when --version is below 1.0.88', async () => {
      setupExec({ '--version': Buffer.from('1.0.35 (Claude Code)\n') });
      const client = new ClaudeCodeMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({
        success: false,
        unsupported: true,
      });
      const commands = execSyncMock.mock.calls.map((c) => String(c[0]));
      expect(commands.some((c) => c.includes('plugin marketplace'))).toBe(
        false,
      );
      expect(commands.some((c) => c.includes('plugin install'))).toBe(false);
      expect(analytics.captureException).not.toHaveBeenCalled();
    });

    it('returns unsupported when --version output cannot be parsed', async () => {
      setupExec({ '--version': Buffer.from('garbled output\n') });
      const client = new ClaudeCodeMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({
        success: false,
        unsupported: true,
      });
      expect(analytics.captureException).not.toHaveBeenCalled();
    });

    it('returns unsupported on "unknown command" without reporting an exception', async () => {
      setupExec({
        'plugin install': new Error("error: unknown command 'install'"),
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({
        success: false,
        unsupported: true,
      });
      expect(analytics.captureException).not.toHaveBeenCalled();
    });

    it('returns unsupported on "needs an update" without reporting an exception', async () => {
      setupExec({
        'plugin install': new Error('Claude Code needs an update to >=1.0.88'),
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({
        success: false,
        unsupported: true,
      });
      expect(analytics.captureException).not.toHaveBeenCalled();
    });

    it('returns unsupported on "not found in any configured marketplace" without reporting', async () => {
      setupExec({
        'plugin install': new Error(
          'Plugin "posthog" not found in any configured marketplace',
        ),
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({
        success: false,
        unsupported: true,
      });
      expect(analytics.captureException).not.toHaveBeenCalled();
    });

    it('returns failure and captures exception on unexpected install error', async () => {
      setupExec({ 'plugin install': new Error('network timeout') });
      const client = new ClaudeCodeMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({ success: false });
      expect(analytics.captureException).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('network timeout'),
        }),
      );
    });

    it('returns failure and captures exception on unexpected marketplace error', async () => {
      setupExec({
        'plugin marketplace add': new Error('network unreachable'),
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({ success: false });
      expect(analytics.captureException).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('network unreachable'),
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
