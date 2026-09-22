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
    // Default: no plugin marketplace registered yet. clearAllMocks keeps
    // implementations, so without this a config.toml fixture set by one test
    // leaks into the next one's isPluginInstalled() check.
    readFileSyncMock.mockReturnValue('');
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

  /** A `codex plugin list -m posthog` table with the given status column. */
  const pluginListing = (status: string) =>
    `Marketplace \`posthog\`\n\nPLUGIN           STATUS  VERSION  SOURCE\nposthog@posthog  ${status}  1.0.61   https://github.com/PostHog/ai-plugin.git\n`;

  describe('isPluginInstalled', () => {
    it('returns true when the plugin itself is installed', async () => {
      spawnSyncMock.mockReturnValue({
        status: 0,
        stdout: pluginListing('installed, enabled'),
        stderr: '',
      });
      const client = new CodexMCPClient();
      await expect(client.isPluginInstalled()).resolves.toBe(true);
    });

    // The defect this replaces: a registered marketplace was read as an
    // installed plugin, so the wizard reported success while `codex plugin
    // list` said `not installed`, and never self-corrected on a re-run.
    it('returns false when the marketplace is registered but the plugin is not installed', async () => {
      readFileSyncMock.mockReturnValue(
        '[marketplaces.posthog]\nsource_type = "git"\n',
      );
      spawnSyncMock.mockReturnValue({
        status: 0,
        stdout: pluginListing('not installed'),
        stderr: '',
      });
      const client = new CodexMCPClient();
      await expect(client.isPluginInstalled()).resolves.toBe(false);
    });

    it('returns false when the plugin is absent from the listing', async () => {
      spawnSyncMock.mockReturnValue({
        status: 0,
        stdout: 'PLUGIN  STATUS  VERSION  SOURCE\n',
        stderr: '',
      });
      const client = new CodexMCPClient();
      await expect(client.isPluginInstalled()).resolves.toBe(false);
    });

    it('returns false when the listing command fails', async () => {
      spawnSyncMock.mockReturnValue({
        status: 1,
        stdout: '',
        stderr: "error: unexpected argument 'plugin'",
      });
      const client = new CodexMCPClient();
      await expect(client.isPluginInstalled()).resolves.toBe(false);
    });
  });

  describe('isServerInstalled', () => {
    it('returns true when config.toml has the posthog server section', async () => {
      readFileSyncMock.mockReturnValue(
        '[mcp_servers.posthog]\nurl = "https://mcp.posthog.com/mcp"\n',
      );
      const client = new CodexMCPClient();
      await expect(client.isServerInstalled()).resolves.toBe(true);
    });

    it('returns false when posthog is absent from config.toml', async () => {
      readFileSyncMock.mockReturnValue(
        '[mcp_servers.other]\nurl = "https://example.com"\n',
      );
      const client = new CodexMCPClient();
      await expect(client.isServerInstalled()).resolves.toBe(false);
    });

    it('returns false when config.toml is unreadable', async () => {
      readFileSyncMock.mockImplementation(() => {
        throw new Error('ENOENT');
      });
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

    it('reports "already" stderr as an already-installed success', async () => {
      spawnSyncMock.mockReturnValue({
        status: 1,
        stderr: "Server 'posthog' already exists",
      });
      const client = new CodexMCPClient();
      await expect(client.addServer('phx_test')).resolves.toEqual({
        success: true,
        alreadyInstalled: true,
      });
    });

    it('returns failure with the reason and captures exception on unexpected error', async () => {
      spawnSyncMock.mockReturnValue({ status: 1, stderr: 'network timeout' });
      const client = new CodexMCPClient();
      await expect(client.addServer('phx_test')).resolves.toEqual({
        success: false,
        reason: 'network timeout',
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
        { encoding: 'utf-8' },
      );
    });

    it('targets the local server name when removing the local MCP', async () => {
      spawnSyncMock.mockReturnValue({ status: 0 });
      const client = new CodexMCPClient();
      await client.removeServer(true);
      expect(spawnSyncMock).toHaveBeenCalledWith(
        CODEX_PATH,
        ['mcp', 'remove', 'posthog-local'],
        { encoding: 'utf-8' },
      );
    });

    it('returns the failure reason and captures exception on failure', async () => {
      spawnSyncMock.mockReturnValue({ status: 1, stderr: 'codex is locked' });
      const client = new CodexMCPClient();
      await expect(client.removeServer()).resolves.toEqual({
        success: false,
        reason: 'codex is locked',
      });
      expect(analytics.captureException).toHaveBeenCalled();
    });
  });

  describe('supportsPlugin', () => {
    it('returns true when codex is in PATH', () => {
      const client = new CodexMCPClient();
      expect(client.supportsPlugin()).toBe(true);
    });

    it('returns false when codex binary is not found', () => {
      execSyncMock.mockImplementation(() => {
        throw new Error('not found');
      });
      const client = new CodexMCPClient();
      expect(client.supportsPlugin()).toBe(false);
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
      let adds = 0;
      spawnSyncMock.mockImplementation((_bin: string, args: string[]) => {
        const cmd = args.join(' ');
        if (cmd.startsWith('plugin list'))
          return {
            status: 0,
            stdout: pluginListing('not installed'),
            stderr: '',
          };
        if (cmd.startsWith('plugin marketplace add')) {
          adds += 1;
          return adds === 1
            ? {
                status: 1,
                stderr:
                  "Error: marketplace 'posthog' is already added from a different source",
              }
            : { status: 0, stderr: '' };
        }
        return { status: 0, stdout: '', stderr: '' };
      });
      const client = new CodexMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({ success: true });
      expect(fs.rmSync).toHaveBeenCalledWith(
        expect.stringContaining('marketplaces/posthog'),
        { recursive: true, force: true },
      );
      expect(adds).toBe(2);
    });

    it('skips the marketplace add when config.toml already has the marketplace', async () => {
      readFileSyncMock.mockReturnValue('[marketplaces.posthog]\n');
      spawnSyncMock.mockImplementation((_bin: string, args: string[]) =>
        args.join(' ').startsWith('plugin list')
          ? { status: 0, stdout: pluginListing('not installed'), stderr: '' }
          : { status: 0, stdout: '', stderr: '' },
      );
      const client = new CodexMCPClient();

      await expect(client.installPlugin()).resolves.toEqual({ success: true });

      const commands = spawnSyncMock.mock.calls.map(
        ([, args]: [string, string[]]) => args.join(' '),
      );
      expect(commands).not.toContain(
        'plugin marketplace add PostHog/ai-plugin',
      );
      expect(commands).toContain('plugin add posthog@posthog');
    });

    it('installs anyway when the marketplace add reports it is already there', async () => {
      spawnSyncMock.mockImplementation((_bin: string, args: string[]) => {
        const cmd = args.join(' ');
        if (cmd.startsWith('plugin list'))
          return {
            status: 0,
            stdout: pluginListing('not installed'),
            stderr: '',
          };
        if (cmd.startsWith('plugin marketplace add'))
          return {
            status: 1,
            stderr: "marketplace 'posthog' is already installed",
          };
        return { status: 0, stdout: '', stderr: '' };
      });
      const client = new CodexMCPClient();

      await expect(client.installPlugin()).resolves.toEqual({ success: true });
      expect(analytics.captureException).not.toHaveBeenCalled();
    });

    it('still reports a failure when the stale-cache retry does not help', async () => {
      // rmSync can fail (EPERM on Windows while codex is running), so the retry
      // hits the same error — that means "not installed", not "already there".
      spawnSyncMock.mockReturnValue({
        status: 1,
        stderr:
          "Error: marketplace 'posthog' is already added from a different source",
      });
      const client = new CodexMCPClient();
      const result = await client.installPlugin();
      expect(result.success).toBe(false);
      expect(analytics.captureException).toHaveBeenCalled();
    });

    it('returns failure with the reason and captures exception on unexpected error', async () => {
      spawnSyncMock.mockImplementation((_bin: string, args: string[]) => {
        const cmd = args.join(' ');
        if (cmd.startsWith('plugin list'))
          return {
            status: 0,
            stdout: pluginListing('not installed'),
            stderr: '',
          };
        if (cmd.startsWith('plugin add'))
          return { status: 1, stderr: 'network timeout' };
        return { status: 0, stdout: '', stderr: '' };
      });
      const client = new CodexMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({
        success: false,
        reason: 'network timeout',
      });
      expect(analytics.captureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Codex plugin install failed' }),
        expect.objectContaining({ details: 'network timeout' }),
      );
    });
  });
  describe('failure reporting', () => {
    // spawnSync splits the cause across error/stderr/stdout. Reading only
    // stderr produced `Codex plugin install failed: ` with a blank reason —
    // 18 events across 18 users in 30 days, useless to both the user and us.
    it('gives an actionable reason when the binary cannot be executed', async () => {
      spawnSyncMock.mockReturnValue({
        error: new Error('spawn /Users/ada/.bun/bin/codex ENOENT'),
        status: null,
        stderr: null,
        stdout: null,
      });
      const client = new CodexMCPClient();

      const result = await client.installPlugin();

      expect(result.success).toBe(false);
      expect(result.reason).toMatch(/reinstall codex/i);
      expect(analytics.captureException).not.toHaveBeenCalled();
    });

    it('reports the spawn error itself when the cause is unrecognised', async () => {
      spawnSyncMock.mockReturnValue({
        error: new Error('spawn EBADF while starting codex'),
        status: null,
        stderr: null,
        stdout: null,
      });
      const client = new CodexMCPClient();

      const result = await client.installPlugin();

      expect(result.reason).toContain('EBADF');
    });

    it('never reports an empty reason, even with no output at all', async () => {
      spawnSyncMock.mockReturnValue({
        status: 3,
        stderr: null,
        stdout: null,
      });
      const client = new CodexMCPClient();

      const result = await client.installPlugin();

      expect(result.reason?.trim()).toBeTruthy();
      expect(result.reason).toContain('3');
    });

    it('reports stdout when the CLI writes its failure there', async () => {
      spawnSyncMock.mockReturnValue({
        status: 1,
        stderr: '',
        stdout: 'the marketplace rejected the manifest',
      });
      const client = new CodexMCPClient();

      const result = await client.installPlugin();

      expect(result.reason).toContain('rejected the manifest');
    });

    it.each([
      ["error: unexpected argument 'marketplace' found", /codex/i],
      ['Error: spawn /Users/ada/.bun/bin/codex ENOENT', /codex/i],
      [
        'Error: failed to load configuration\n\nCaused by: invalid type',
        /config/i,
      ],
      ['EACCES: permission denied', /permission/i],
      ['No space left on device (os error 28)', /space|disk/i],
    ])(
      'hints instead of reporting a local-environment failure: %s',
      async (stderr, expected) => {
        spawnSyncMock.mockReturnValue({ status: 1, stderr });
        const client = new CodexMCPClient();

        const result = await client.installPlugin();

        expect(result.success).toBe(false);
        expect(result.reason).toMatch(expected);
        expect(analytics.captureException).not.toHaveBeenCalled();
      },
    );

    // One root cause was 29 issue ids for Claude Code because $HOME sat in the
    // message. Keep the message constant and put the detail in properties.
    it('reports an unexpected failure under a constant message with scrubbed detail', async () => {
      spawnSyncMock.mockImplementation((_bin: string, args: string[]) => {
        const cmd = args.join(' ');
        if (cmd.startsWith('plugin list'))
          return {
            status: 0,
            stdout: pluginListing('not installed'),
            stderr: '',
          };
        if (cmd.startsWith('plugin add'))
          return {
            status: 1,
            stderr: 'weird new failure in /Users/ada/.codex/config.toml',
          };
        return { status: 0, stdout: '', stderr: '' };
      });
      const client = new CodexMCPClient();

      await client.installPlugin();

      expect(analytics.captureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Codex plugin install failed' }),
        expect.objectContaining({
          details: expect.stringContaining('~/.codex/config.toml'),
        }),
      );
      const [, props] = (analytics.captureException as Mock).mock.calls[0];
      expect(props.details).not.toContain('/Users/ada');
    });
  });
  describe('plugin install and removal', () => {
    /** Every codex invocation, in order, as its joined command. */
    const codexCalls = () =>
      spawnSyncMock.mock.calls.map(([, args]: [string, string[]]) =>
        args.join(' '),
      );

    const route = (handler: (cmd: string) => object) => {
      spawnSyncMock.mockImplementation((_bin: string, args: string[]) =>
        handler(args.join(' ')),
      );
    };

    // `plugin marketplace add` registers the catalog only; without the
    // `plugin add` the wizard reported success and the user got no skills.
    it('installs the plugin after registering the marketplace', async () => {
      route((cmd) =>
        cmd.startsWith('plugin list')
          ? { status: 0, stdout: pluginListing('not installed'), stderr: '' }
          : { status: 0, stdout: '', stderr: '' },
      );
      const client = new CodexMCPClient();

      await expect(client.installPlugin()).resolves.toEqual({ success: true });

      expect(codexCalls()).toContain(
        'plugin marketplace add PostHog/ai-plugin',
      );
      expect(codexCalls()).toContain('plugin add posthog@posthog');
    });

    it('installs the plugin for a user who already has the marketplace', async () => {
      readFileSyncMock.mockReturnValue('[marketplaces.posthog]\n');
      route((cmd) =>
        cmd.startsWith('plugin list')
          ? { status: 0, stdout: pluginListing('not installed'), stderr: '' }
          : { status: 0, stdout: '', stderr: '' },
      );
      const client = new CodexMCPClient();

      await expect(client.installPlugin()).resolves.toEqual({ success: true });

      expect(codexCalls()).toContain('plugin add posthog@posthog');
    });

    it('does nothing when the plugin is already installed', async () => {
      route(() => ({
        status: 0,
        stdout: pluginListing('installed, enabled'),
        stderr: '',
      }));
      const client = new CodexMCPClient();

      await expect(client.installPlugin()).resolves.toEqual({
        success: true,
        alreadyInstalled: true,
      });
      expect(codexCalls().some((c) => c.startsWith('plugin add'))).toBe(false);
    });

    it('reports a failing plugin add rather than claiming success', async () => {
      route((cmd) => {
        if (cmd.startsWith('plugin list'))
          return {
            status: 0,
            stdout: pluginListing('not installed'),
            stderr: '',
          };
        if (cmd.startsWith('plugin add'))
          return { status: 1, stdout: '', stderr: 'manifest rejected' };
        return { status: 0, stdout: '', stderr: '' };
      });
      const client = new CodexMCPClient();

      const result = await client.installPlugin();

      expect(result.success).toBe(false);
      expect(result.reason).toContain('manifest rejected');
    });

    it('removes the plugin and the marketplace it came from', async () => {
      readFileSyncMock.mockReturnValue('[marketplaces.posthog]\n');
      route((cmd) =>
        cmd.startsWith('plugin list')
          ? {
              status: 0,
              stdout: pluginListing('installed, enabled'),
              stderr: '',
            }
          : { status: 0, stdout: '', stderr: '' },
      );
      const client = new CodexMCPClient();

      await expect(client.removePlugin()).resolves.toEqual({ success: true });

      expect(codexCalls()).toContain('plugin remove posthog@posthog');
      expect(codexCalls()).toContain('plugin marketplace remove posthog');
    });

    // The state this PR fixes: marketplace registered, plugin never installed.
    // `mcp remove` must still clear the marketplace rather than skip.
    it('removes a registered marketplace even when no plugin was installed', async () => {
      readFileSyncMock.mockReturnValue('[marketplaces.posthog]\n');
      route((cmd) =>
        cmd.startsWith('plugin list')
          ? { status: 0, stdout: pluginListing('not installed'), stderr: '' }
          : { status: 0, stdout: '', stderr: '' },
      );
      const client = new CodexMCPClient();

      await expect(client.removePlugin()).resolves.toEqual({ success: true });

      expect(codexCalls()).toContain('plugin marketplace remove posthog');
      expect(codexCalls().some((c) => c.startsWith('plugin remove'))).toBe(
        false,
      );
    });

    it('reports nothing to do when neither the plugin nor the marketplace is there', async () => {
      readFileSyncMock.mockReturnValue('');
      route((cmd) =>
        cmd.startsWith('plugin list')
          ? { status: 0, stdout: pluginListing('not installed'), stderr: '' }
          : { status: 0, stdout: '', stderr: '' },
      );
      const client = new CodexMCPClient();

      await expect(client.removePlugin()).resolves.toEqual({
        success: true,
        alreadyInstalled: true,
      });
      expect(codexCalls().some((c) => c.includes('remove'))).toBe(false);
    });
  });
});
