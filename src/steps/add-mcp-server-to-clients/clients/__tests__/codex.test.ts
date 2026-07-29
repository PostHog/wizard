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

    it('reads config.toml from CODEX_HOME when it is set', async () => {
      vi.stubEnv('CODEX_HOME', '/custom/codex-home');
      readFileSyncMock.mockReturnValue('[marketplaces.posthog]\n');
      const client = new CodexMCPClient();
      await expect(client.isPluginInstalled()).resolves.toBe(true);
      expect(readFileSyncMock).toHaveBeenCalledWith(
        '/custom/codex-home/config.toml',
        'utf-8',
      );
      vi.unstubAllEnvs();
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
    const HELP_WITH_PLUGIN = [
      'Commands:',
      '  mcp             Manage external MCP servers for Codex',
      '  plugin          Manage Codex plugins',
      '  help            Print this message',
    ].join('\n');

    const HELP_WITHOUT_PLUGIN = [
      'Commands:',
      '  exec        Run Codex non-interactively',
      '  login       Manage login',
    ].join('\n');

    it('returns true when the CLI lists a plugin subcommand', () => {
      spawnSyncMock.mockReturnValue({ status: 0, stdout: HELP_WITH_PLUGIN });
      const client = new CodexMCPClient();
      expect(client.supportsPlugin()).toBe(true);
      expect(spawnSyncMock).toHaveBeenCalledWith(CODEX_PATH, ['--help'], {
        encoding: 'utf-8',
      });
    });

    it('returns false on an older CLI with no plugin subcommand', () => {
      spawnSyncMock.mockReturnValue({ status: 0, stdout: HELP_WITHOUT_PLUGIN });
      const client = new CodexMCPClient();
      expect(client.supportsPlugin()).toBe(false);
    });

    it('returns false when the binary cannot be spawned', () => {
      spawnSyncMock.mockReturnValue({
        status: null,
        error: new Error('spawn ENOENT'),
      });
      const client = new CodexMCPClient();
      expect(client.supportsPlugin()).toBe(false);
    });

    it('caches the probe result across calls', () => {
      spawnSyncMock.mockReturnValue({ status: 0, stdout: HELP_WITH_PLUGIN });
      const client = new CodexMCPClient();
      client.supportsPlugin();
      client.supportsPlugin();
      expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    });

    it('returns false when codex binary is not found', () => {
      execSyncMock.mockImplementation(() => {
        throw new Error('not found');
      });
      const client = new CodexMCPClient();
      expect(client.supportsPlugin()).toBe(false);
      expect(spawnSyncMock).not.toHaveBeenCalled();
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

    it('reports the spawn error when the process never starts', async () => {
      spawnSyncMock.mockReturnValue({
        status: null,
        signal: null,
        error: Object.assign(new Error('spawn /usr/bin/codex EACCES'), {
          code: 'EACCES',
        }),
        stdout: '',
        stderr: '',
      });
      const client = new CodexMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({ success: false });
      expect(analytics.captureException).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            'Codex plugin install failed: spawn error: spawn /usr/bin/codex EACCES',
        }),
      );
    });

    it('reports the exit code and stdout when stderr is empty', async () => {
      spawnSyncMock.mockReturnValue({
        status: 3,
        signal: null,
        stdout: 'something broke',
        stderr: '',
      });
      const client = new CodexMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({ success: false });
      expect(analytics.captureException).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            'Codex plugin install failed: exit 3 | stdout: something broke',
        }),
      );
    });

    it('never captures an exception with an empty tail', async () => {
      spawnSyncMock.mockReturnValue({
        status: 1,
        signal: null,
        stdout: '',
        stderr: '',
      });
      const client = new CodexMCPClient();
      await client.installPlugin();
      expect(analytics.captureException).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Codex plugin install failed: exit 1',
        }),
      );
    });

    it('falls back to a placeholder when spawnSync reports nothing at all', async () => {
      spawnSyncMock.mockReturnValue({
        status: null,
        signal: null,
        stdout: '',
        stderr: '',
      });
      const client = new CodexMCPClient();
      await client.installPlugin();
      expect(analytics.captureException).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Codex plugin install failed: no output, status unavailable',
        }),
      );
    });

    it('does not capture when the CLI is too old for the marketplace subcommand', async () => {
      spawnSyncMock.mockReturnValue({
        status: 2,
        stderr: "error: unexpected argument 'marketplace' found\n",
      });
      const client = new CodexMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({ success: false });
      expect(analytics.captureException).not.toHaveBeenCalled();
    });

    it('does not capture on a transient network failure', async () => {
      spawnSyncMock.mockReturnValue({
        status: 128,
        stderr:
          'fatal: unable to access https://github.com/PostHog/ai-plugin.git/: LibreSSL SSL_connect: SSL_ERROR_SYSCALL',
      });
      const client = new CodexMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({ success: false });
      expect(analytics.captureException).not.toHaveBeenCalled();
    });

    it('does not capture when the user interrupts the install', async () => {
      spawnSyncMock.mockReturnValue({
        status: null,
        signal: 'SIGINT',
        stdout: '',
        stderr: '',
      });
      const client = new CodexMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({ success: false });
      expect(analytics.captureException).not.toHaveBeenCalled();
    });

    it('clears the stale cache under CODEX_HOME when it is set', async () => {
      vi.stubEnv('CODEX_HOME', '/custom/codex-home');
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
        '/custom/codex-home/.tmp/marketplaces/posthog',
        { recursive: true, force: true },
      );
      vi.unstubAllEnvs();
    });
  });
});
