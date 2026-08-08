import { CodexMCPClient } from '@steps/add-mcp-server-to-clients/clients/codex';
import { execSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { analytics } from '@utils/analytics';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  rmSync: vi.fn(),
}));

vi.mock('../../../../utils/analytics', () => ({
  analytics: { captureException: vi.fn() },
}));

describe('CodexMCPClient', () => {
  const spawnSyncMock = spawnSync as Mock;
  const execSyncMock = execSync as Mock;
  const readFileSyncMock = fs.readFileSync as Mock;

  const CODEX_PATH = '/usr/local/bin/codex';

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: codex found via command -v
    execSyncMock.mockReturnValue(Buffer.from(CODEX_PATH + '\n'));
  });

  describe('isClientSupported', () => {
    it('returns true when codex is in PATH', async () => {
      const client = new CodexMCPClient();
      await expect(client.isClientSupported()).resolves.toBe(true);
      expect(execSyncMock).toHaveBeenCalledWith('command -v codex', {
        stdio: 'pipe',
      });
    });

    it('returns false when codex is not in PATH', async () => {
      execSyncMock.mockImplementation(() => {
        throw new Error('not found');
      });
      const client = new CodexMCPClient();
      await expect(client.isClientSupported()).resolves.toBe(false);
    });
  });

  describe('isPluginInstalled', () => {
    it('returns true when posthog marketplace section exists in config.toml', async () => {
      readFileSyncMock.mockReturnValue(
        '[marketplaces.posthog]\nsource_type = "git"\n',
      );
      const client = new CodexMCPClient();
      await expect(client.isPluginInstalled()).resolves.toBe(true);
    });

    it('returns false when posthog is absent from config.toml', async () => {
      readFileSyncMock.mockReturnValue(
        '[marketplaces.openai-bundled]\nsource_type = "local"\n',
      );
      const client = new CodexMCPClient();
      await expect(client.isPluginInstalled()).resolves.toBe(false);
    });

    it('returns false when config.toml cannot be read', async () => {
      readFileSyncMock.mockImplementation(() => {
        throw new Error('ENOENT');
      });
      const client = new CodexMCPClient();
      await expect(client.isPluginInstalled()).resolves.toBe(false);
    });
  });

  describe('isServerInstalled', () => {
    it('returns true when posthog appears in mcp list output', async () => {
      spawnSyncMock.mockReturnValue({
        status: 0,
        stdout: 'posthog\n',
        stderr: '',
      });
      const client = new CodexMCPClient();
      await expect(client.isServerInstalled()).resolves.toBe(true);
    });

    it('returns false when posthog is absent from mcp list output', async () => {
      spawnSyncMock.mockReturnValue({
        status: 0,
        stdout: 'other-server\n',
        stderr: '',
      });
      const client = new CodexMCPClient();
      await expect(client.isServerInstalled()).resolves.toBe(false);
    });

    it('returns false when mcp list exits non-zero', async () => {
      spawnSyncMock.mockReturnValue({ status: 1, stdout: '', stderr: 'err' });
      const client = new CodexMCPClient();
      await expect(client.isServerInstalled()).resolves.toBe(false);
    });
  });

  describe('addServer', () => {
    it('runs codex mcp add with the resolved URL and returns success on exit 0', async () => {
      spawnSyncMock.mockReturnValue({ status: 0, stderr: '' });
      const client = new CodexMCPClient();
      await expect(client.addServer('phx_test')).resolves.toEqual({
        success: true,
      });
      const call = spawnSyncMock.mock.calls[0]!;
      expect(call[0]).toBe(CODEX_PATH);
      expect(call[1]).toEqual([
        'mcp',
        'add',
        'posthog',
        '--url',
        'https://mcp.posthog.com/mcp',
        '--bearer-token-env-var',
        'POSTHOG_AUTH_HEADER',
      ]);
      expect(call[2].env.POSTHOG_AUTH_HEADER).toBe('Bearer phx_test');
    });

    it('treats "already" stderr as success', async () => {
      spawnSyncMock.mockReturnValue({
        status: 1,
        stderr: "Server 'posthog' already exists",
      });
      const client = new CodexMCPClient();
      await expect(client.addServer('phx_test')).resolves.toEqual({
        success: true,
      });
    });

    it('returns failure and captures exception on unexpected error', async () => {
      spawnSyncMock.mockReturnValue({ status: 1, stderr: 'network timeout' });
      const client = new CodexMCPClient();
      await expect(client.addServer('phx_test')).resolves.toEqual({
        success: false,
      });
      expect(analytics.captureException).toHaveBeenCalled();
    });
  });

  describe('removeServer', () => {
    it('invokes the resolved binary with mcp remove and returns success', async () => {
      spawnSyncMock.mockReturnValue({ status: 0 });
      const client = new CodexMCPClient();
      await expect(client.removeServer()).resolves.toEqual({ success: true });
      expect(spawnSyncMock).toHaveBeenCalledWith(
        CODEX_PATH,
        ['mcp', 'remove', 'posthog'],
        { stdio: 'ignore' },
      );
    });

    it('returns false and captures exception on failure', async () => {
      spawnSyncMock.mockReturnValue({ status: 1 });
      const client = new CodexMCPClient();
      await expect(client.removeServer()).resolves.toEqual({ success: false });
      expect(analytics.captureException).toHaveBeenCalled();
    });
  });

  describe('supportsPlugin', () => {
    it('returns true when codex knows the plugin marketplace subcommand', () => {
      spawnSyncMock.mockReturnValue({
        status: 0,
        stdout: 'Usage: codex plugin marketplace <COMMAND>',
        stderr: '',
      });
      const client = new CodexMCPClient();
      expect(client.supportsPlugin()).toBe(true);
      expect(spawnSyncMock).toHaveBeenCalledWith(
        CODEX_PATH,
        ['plugin', 'marketplace', '--help'],
        { encoding: 'utf-8' },
      );
    });

    it('returns false when codex binary is not found', () => {
      execSyncMock.mockImplementation(() => {
        throw new Error('not found');
      });
      const client = new CodexMCPClient();
      expect(client.supportsPlugin()).toBe(false);
    });

    it('returns false when codex is too old to know the marketplace subcommand', () => {
      spawnSyncMock.mockReturnValue({
        status: 2,
        stdout: '',
        stderr: "error: unexpected argument 'marketplace' found",
      });
      const client = new CodexMCPClient();
      expect(client.supportsPlugin()).toBe(false);
    });

    it('caches the feature-detection result across calls', () => {
      spawnSyncMock.mockReturnValue({
        status: 0,
        stdout: 'Usage: codex plugin marketplace <COMMAND>',
        stderr: '',
      });
      const client = new CodexMCPClient();
      expect(client.supportsPlugin()).toBe(true);
      expect(client.supportsPlugin()).toBe(true);
      // Only one probe despite two calls.
      expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('installPlugin', () => {
    it('returns success on exit 0 using resolved binary path', async () => {
      spawnSyncMock.mockReturnValue({ status: 0, stderr: '' });
      const client = new CodexMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({ success: true });
      expect(spawnSyncMock).toHaveBeenCalledWith(
        CODEX_PATH,
        ['plugin', 'marketplace', 'add', 'PostHog/ai-plugin'],
        { encoding: 'utf-8' },
      );
    });

    it('clears stale cache and retries when marketplace is already added from a different source', async () => {
      spawnSyncMock
        .mockReturnValueOnce({
          status: 1,
          stderr:
            "Error: marketplace 'posthog' is already added from a different source",
        })
        .mockReturnValueOnce({ status: 0, stderr: '' });
      const client = new CodexMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({ success: true });
      expect(fs.rmSync).toHaveBeenCalledWith(
        expect.stringContaining('marketplaces/posthog'),
        { recursive: true, force: true },
      );
      expect(spawnSyncMock).toHaveBeenCalledTimes(2);
    });

    it('returns failure and captures exception on unexpected error', async () => {
      spawnSyncMock.mockReturnValue({ status: 1, stderr: 'network timeout' });
      const client = new CodexMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({ success: false });
      expect(analytics.captureException).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('network timeout'),
        }),
      );
    });

    it('skips cleanly without capturing an exception on older Codex versions', async () => {
      spawnSyncMock.mockReturnValue({
        status: 2,
        stdout: '',
        stderr: "error: unexpected argument 'marketplace' found",
      });
      const client = new CodexMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({ success: false });
      expect(analytics.captureException).not.toHaveBeenCalled();
    });
  });
});
