import { CodexMCPClient } from '@steps/add-mcp-server-to-clients/clients/codex';
import { execSync, execFile } from 'node:child_process';
import * as fs from 'node:fs';
import { analytics } from '@utils/analytics';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  execFile: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  rmSync: vi.fn(),
}));

vi.mock('@utils/analytics', () => ({
  analytics: { captureException: vi.fn(), wizardCapture: vi.fn() },
}));

describe('CodexMCPClient', () => {
  const execFileMock = execFile as unknown as Mock;

  /** Every codex invocation, in order, as its joined arguments. */
  const codexCalls = (): string[] =>
    execFileMock.mock.calls.map((c: unknown[]) => (c[1] as string[]).join(' '));

  /** The binary each invocation was given. */
  const codexBinaries = (): string[] =>
    execFileMock.mock.calls.map((c: unknown[]) => c[0] as string);

  /**
   * Answer codex invocations by their joined arguments. Return a string for
   * stdout on success, or an Error to fail that call.
   */
  type CodexReply =
    | string
    | Error
    | { error: Error; stdout?: string; stderr?: string };
  const routeCodex = (handler: (cmd: string) => CodexReply) => {
    execFileMock.mockImplementation((...a: unknown[]) => {
      const args = a[1] as string[];
      const cb = a[a.length - 1] as (
        e: Error | null,
        stdout: string,
        stderr: string,
      ) => void;
      const out = handler(args.join(' '));
      if (typeof out === 'string') return cb(null, out, '');
      if (out instanceof Error) return cb(out, '', '');
      cb(out.error, out.stdout ?? '', out.stderr ?? '');
    });
  };

  /** A process that never started: execFile reports it on the error alone. */
  const spawnError = (message: string, code = 'ENOENT') =>
    Object.assign(new Error(message), { code });

  /** A CLI that ran and failed: execFile reports it on both the error and stderr. */
  const cliError = (stderr: string, code = 1) => ({
    error: Object.assign(new Error(`Command failed: codex\n${stderr}`), {
      code,
    }),
    stderr,
  });

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
      routeCodex(() => pluginListing('installed, enabled'));
      const client = new CodexMCPClient();
      await expect(client.isPluginInstalled()).resolves.toBe(true);
    });

    // The defect this replaces: a registered marketplace was read as an
    // installed plugin, so the wizard reported success while `codex plugin
    // list` said `not installed`, and never self-corrected on a re-run.
    it('reports a registered marketplace with no plugin, so removal can clear it', async () => {
      // `index.ts` asks this to decide whether there is anything to remove.
      // The marketplace alone is something: the wizard registered it, and
      // answering false here strands it on the machine for good. The install
      // decision asks the narrower question and still runs — the test below.
      readFileSyncMock.mockReturnValue(
        '[marketplaces.posthog]\nsource_type = "git"\n',
      );
      routeCodex(() => pluginListing('not installed'));
      const client = new CodexMCPClient();
      await expect(client.isPluginInstalled()).resolves.toBe(true);
    });

    it('treats an unreadable config.toml as no marketplace, not a crash', async () => {
      // A fresh machine has no `~/.codex/config.toml` at all. `readFileSync`
      // throws there, and an exception out of discovery would take down every
      // client's removal, not just Codex's.
      readFileSyncMock.mockImplementation(() => {
        throw new Error(
          "ENOENT: no such file or directory, open 'config.toml'",
        );
      });
      routeCodex(() => pluginListing('not installed'));
      const client = new CodexMCPClient();
      await expect(client.isPluginInstalled()).resolves.toBe(false);
    });

    it('reports nothing when neither the plugin nor our marketplace is there', async () => {
      readFileSyncMock.mockReturnValue('');
      routeCodex(() => pluginListing('not installed'));
      const client = new CodexMCPClient();
      await expect(client.isPluginInstalled()).resolves.toBe(false);
    });

    it('returns false when the plugin is absent from the listing', async () => {
      routeCodex(() => 'PLUGIN  STATUS  VERSION  SOURCE\n');
      const client = new CodexMCPClient();
      await expect(client.isPluginInstalled()).resolves.toBe(false);
    });

    it('returns false when the listing command fails', async () => {
      routeCodex(() => cliError("error: unexpected argument 'plugin'"));
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
      routeCodex(() => '');
      const client = new CodexMCPClient();
      await expect(client.addServer('phx_test')).resolves.toEqual({
        success: true,
      });
      const call = execFileMock.mock.calls[0] as [
        string,
        string[],
        { env: Record<string, string> },
      ];
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
      routeCodex(() => cliError("Server 'posthog' already exists"));
      const client = new CodexMCPClient();
      await expect(client.addServer('phx_test')).resolves.toEqual({
        success: true,
        alreadyInstalled: true,
      });
    });

    it('returns failure with the reason and captures exception on unexpected error', async () => {
      routeCodex(() => cliError('network timeout'));
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
      routeCodex(() => '');
      const client = new CodexMCPClient();
      await expect(client.removeServer()).resolves.toEqual({ success: true });
      expect(codexBinaries()).toContain(CODEX_PATH);
      expect(codexCalls()).toContain('mcp remove posthog');
    });

    it('targets the local server name when removing the local MCP', async () => {
      routeCodex(() => '');
      const client = new CodexMCPClient();
      await client.removeServer(true);
      expect(codexCalls()).toContain('mcp remove posthog-local');
    });

    it('returns the failure reason and captures exception on failure', async () => {
      routeCodex(() => cliError('codex is locked'));
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
      routeCodex((cmd) =>
        cmd.startsWith('plugin list') ? pluginListing('not installed') : '',
      );
      const client = new CodexMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({ success: true });
      expect(codexBinaries()).toContain(CODEX_PATH);
      expect(codexCalls()).toContain(
        'plugin marketplace add PostHog/ai-plugin',
      );
    });

    it('clears stale cache and retries when marketplace is already added from a different source', async () => {
      let adds = 0;
      routeCodex((cmd) => {
        if (cmd.startsWith('plugin list'))
          return pluginListing('not installed');
        if (cmd.startsWith('plugin marketplace add')) {
          adds += 1;
          return adds === 1
            ? cliError(
                "Error: marketplace 'posthog' is already added from a different source",
              )
            : '';
        }
        return '';
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
      routeCodex((cmd) =>
        cmd.startsWith('plugin list') ? pluginListing('not installed') : '',
      );
      const client = new CodexMCPClient();

      await expect(client.installPlugin()).resolves.toEqual({ success: true });

      const commands = codexCalls();
      expect(commands).not.toContain(
        'plugin marketplace add PostHog/ai-plugin',
      );
      expect(commands).toContain('plugin add posthog@posthog');
    });

    it('installs anyway when the marketplace add reports it is already there', async () => {
      routeCodex((cmd) => {
        if (cmd.startsWith('plugin list'))
          return pluginListing('not installed');
        if (cmd.startsWith('plugin marketplace add'))
          return cliError("marketplace 'posthog' is already installed");
        return '';
      });
      const client = new CodexMCPClient();

      await expect(client.installPlugin()).resolves.toEqual({ success: true });
      expect(analytics.captureException).not.toHaveBeenCalled();
    });

    it('still reports a failure when the stale-cache retry does not help', async () => {
      // rmSync can fail (EPERM on Windows while codex is running), so the retry
      // hits the same error — that means "not installed", not "already there".
      routeCodex(() =>
        cliError(
          "Error: marketplace 'posthog' is already added from a different source",
        ),
      );
      const client = new CodexMCPClient();
      const result = await client.installPlugin();
      expect(result.success).toBe(false);
      expect(analytics.captureException).toHaveBeenCalled();
    });

    it('returns failure with the reason and captures exception on unexpected error', async () => {
      routeCodex((cmd) => {
        if (cmd.startsWith('plugin list'))
          return pluginListing('not installed');
        if (cmd.startsWith('plugin add')) return cliError('network timeout');
        return '';
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
      routeCodex(() => spawnError('spawn /Users/ada/.bun/bin/codex ENOENT'));
      const client = new CodexMCPClient();

      const result = await client.installPlugin();

      expect(result.success).toBe(false);
      expect(result.reason).toMatch(/reinstall codex/i);
      expect(analytics.captureException).not.toHaveBeenCalled();
    });

    it('reports the spawn error itself when the cause is unrecognised', async () => {
      routeCodex(() => spawnError('spawn EBADF while starting codex', 'EBADF'));
      const client = new CodexMCPClient();

      const result = await client.installPlugin();

      expect(result.reason).toContain('EBADF');
    });

    it('never reports an empty reason, even with no output at all', async () => {
      // Exited non-zero, said nothing on either stream.
      routeCodex(() => Object.assign(new Error(''), { code: 3 }));
      const client = new CodexMCPClient();

      const result = await client.installPlugin();

      expect(result.reason?.trim()).toBeTruthy();
      expect(result.reason).toContain('3');
    });

    it('reports stdout when the CLI writes its failure there', async () => {
      routeCodex(() => ({
        error: Object.assign(new Error(''), { code: 1 }),
        stdout: 'the marketplace rejected the manifest',
      }));
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
        routeCodex(() => cliError(stderr));
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
      routeCodex((cmd) => {
        if (cmd.startsWith('plugin list'))
          return pluginListing('not installed');
        if (cmd.startsWith('plugin add'))
          return cliError('weird new failure in /Users/ada/.codex/config.toml');
        return '';
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
  /**
   * Silencing a failure is the expensive direction: a hint retires it from
   * error tracking, so a pattern that claims too much turns one of our bugs
   * into advice the user cannot act on and nobody counts.
   */
  describe('what the hint table refuses to claim', () => {
    /** An API-key install, which is the only path through `codex mcp add`. */
    const failingApiKeyInstall = async (stderr: string) => {
      routeCodex(() => cliError(stderr));
      const client = new CodexMCPClient();
      return client.addServer('phx_test');
    };

    /** A plugin install that gets past the listing and fails on `plugin add`. */
    const failingPluginInstall = async (stderr: string) => {
      routeCodex((cmd) => {
        if (cmd.startsWith('plugin list'))
          return pluginListing('not installed');
        if (cmd.startsWith('plugin add')) return cliError(stderr);
        return '';
      });
      const client = new CodexMCPClient();
      return client.installPlugin();
    };

    // The plugin advice fires on an old CLI, but during `mcp add` the rejected
    // argument is a flag we passed, not a plugin subcommand, so sending the
    // user to `codex plugin marketplace add` names a command that has nothing
    // to do with what just failed.
    it('does not give plugin advice when an old CLI rejects an mcp add flag', async () => {
      const result = await failingApiKeyInstall(
        "error: unexpected argument '--bearer-token-env-var' found",
      );
      expect(result.success).toBe(false);
      expect(result.reason).toMatch(/update codex/i);
      expect(result.reason).not.toMatch(/plugin marketplace add/i);
    });

    // Serde wording says nothing about whose file it came from. Blaming the
    // user's config for our own broken manifest sends them to edit a file that
    // is fine, and takes our bug out of error tracking on the way.
    it.each([
      ['invalid type: string, expected a sequence in plugin.toml'],
      ['field `entrypoint` is no longer supported (PostHog/ai-plugin)'],
      ['`skills` must contain at least one entry in plugin.toml'],
    ])(
      'reports a broken plugin manifest rather than blaming the config: %s',
      async (stderr) => {
        const result = await failingPluginInstall(stderr);
        expect(result.reason).not.toMatch(/could not read its own config/i);
        expect(analytics.captureException).toHaveBeenCalledWith(
          expect.objectContaining({ message: 'Codex plugin install failed' }),
          expect.anything(),
        );
      },
    );

    // A clone that fails because the repo is gone is our publishing problem.
    // "Check your network" buries a renamed or deleted PostHog/ai-plugin where
    // nobody will ever see it.
    it('reports a missing plugin repository rather than blaming the network', async () => {
      const result = await failingPluginInstall(
        'git clone https://github.com/PostHog/ai-plugin failed: repository not found',
      );
      expect(result.reason).not.toMatch(/check your network/i);
      expect(analytics.captureException).toHaveBeenCalled();
    });

    // git's SSH clone failure says `Permission denied (publickey)`, which has
    // nothing to do with ~/.codex. Telling the user to fix permissions there
    // sends them to chmod a directory that is already fine.
    it('reports an ssh clone rejection rather than blaming ~/.codex', async () => {
      const result = await failingPluginInstall(
        'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.',
      );
      expect(result.reason).not.toMatch(/permissions on ~\/.codex/i);
      expect(analytics.captureException).toHaveBeenCalled();
    });

    // A failure that merely mentions the config path is not a config failure.
    it('reports an unrecognised failure that only mentions config.toml', async () => {
      const result = await failingPluginInstall(
        'weird new failure while reading /Users/ada/.codex/config.toml',
      );
      expect(result.reason).not.toMatch(/could not read its own config/i);
      expect(analytics.captureException).toHaveBeenCalled();
    });

    // A genuine config failure still hints, or the narrowing went too far.
    it('still hints when codex cannot load its own configuration', async () => {
      const result = await failingPluginInstall(
        'failed to load configuration: invalid type: string, expected a map',
      );
      expect(result.reason).toMatch(/could not read its own config/i);
      expect(analytics.captureException).not.toHaveBeenCalled();
    });

    // Hinting removes the failure from error tracking, so without a counter the
    // only sign a pattern has started over-matching is that our exception count
    // fell — which reads exactly like the fix working.
    it('counts a hinted failure so over-matching stays visible', async () => {
      await failingPluginInstall('ENOSPC: no space left on device');
      expect(analytics.wizardCapture).toHaveBeenCalledWith(
        'mcp expected failure hinted',
        expect.objectContaining({ client: 'Codex', stage: 'plugin install' }),
      );
    });

    it('scrubs home directories from the counted detail', async () => {
      await failingPluginInstall(
        'EACCES: permission denied on /Users/ada/.codex/config.toml',
      );
      const [, props] = (analytics.wizardCapture as Mock).mock.calls[0] as [
        string,
        Record<string, string>,
      ];
      expect(props.details).toContain('~/.codex');
      expect(props.details).not.toContain('/Users/ada');
    });
  });

  /**
   * `execFile` always sets a message, and it leads with the full binary path —
   * a per-user string. Reporting it splits one root cause into one issue per
   * machine, which is the failure this reporting exists to prevent.
   */
  // The listing can report "not installed" when it merely failed to run, and
  // every other spawn here reads codex's own wording rather than turning a
  // no-op into a reported failure.
  describe('plugin add on an already-installed plugin', () => {
    it('treats codex saying it is already installed as success', async () => {
      routeCodex((cmd) => {
        if (cmd.startsWith('plugin list'))
          return pluginListing('not installed');
        if (cmd.startsWith('plugin add'))
          return cliError('plugin posthog@posthog is already installed');
        return '';
      });
      const client = new CodexMCPClient();
      const result = await client.installPlugin();
      expect(result).toEqual({ success: true, alreadyInstalled: true });
      expect(analytics.captureException).not.toHaveBeenCalled();
    });
  });

  // `mcp remove` used to interpolate its reason into the exception message, so
  // a config path in the reason filed one issue per user.
  describe('removeServer failure reporting', () => {
    it('reports under a constant message with the detail in properties', async () => {
      routeCodex(() =>
        cliError('could not write /Users/ada/.codex/config.toml'),
      );
      const client = new CodexMCPClient();
      const result = await client.removeServer();
      expect(result.success).toBe(false);
      expect(analytics.captureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Codex MCP remove failed' }),
        expect.objectContaining({
          details: expect.not.stringContaining('/Users/ada'),
        }),
      );
    });
  });

  describe('what a failure reports when neither stream spoke', () => {
    const silentExit = () => ({
      error: Object.assign(
        new Error(
          'Command failed: /Users/ada/.bun/bin/codex plugin add posthog@posthog',
        ),
        { code: 3 },
      ),
      stdout: '',
      stderr: '',
    });

    const runSilentFailure = async () => {
      routeCodex((cmd) => {
        if (cmd.startsWith('plugin list'))
          return pluginListing('not installed');
        if (cmd.startsWith('plugin add')) return silentExit();
        return '';
      });
      const client = new CodexMCPClient();
      return client.installPlugin();
    };

    it('reports the exit status rather than our own invocation', async () => {
      const result = await runSilentFailure();
      expect(result.reason).toContain('3');
      expect(result.reason).not.toContain('Command failed');
      expect(result.reason).not.toContain('/Users/ada');
    });

    it('keeps the reported detail free of the user home directory', async () => {
      await runSilentFailure();
      const [, props] = (analytics.captureException as Mock).mock.calls[0] as [
        Error,
        Record<string, string>,
      ];
      expect(props.details).not.toContain('/Users/ada');
    });

    // The bearer token is passed to `codex mcp add` in the environment, so a
    // CLI that echoes its environment back on failure puts it in the reason and
    // in the analytics properties.
    it('redacts a bearer token the CLI echoed back', async () => {
      routeCodex(() =>
        cliError('rejected request with header Bearer phx_supersecrettoken'),
      );
      const client = new CodexMCPClient();
      const result = await client.addServer('phx_supersecrettoken');
      expect(result.reason).not.toContain('phx_supersecrettoken');
      expect(result.reason).toContain('[redacted]');
    });

    // A kill is ours, not codex's. Whatever the streams got out before we cut
    // them off reads as codex rejecting the install, which sends the user to
    // fix something that was never wrong.
    it('reports our own kill rather than the output it interrupted', async () => {
      routeCodex((cmd) => {
        if (cmd.startsWith('plugin list'))
          return pluginListing('not installed');
        if (cmd.startsWith('plugin add'))
          return {
            error: Object.assign(new Error('Command failed: codex'), {
              killed: true,
              code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
            }),
            stderr: 'Cloning into ...',
          };
        return '';
      });
      const client = new CodexMCPClient();
      const result = await client.installPlugin();
      expect(result.reason).not.toContain('Cloning into');
      expect(result.reason).toMatch(/more output than|stopped/i);
    });

    // A codex that waits on input never settles the promise, and a clone that
    // outgrows the buffer gets killed and reads as codex rejecting the install.
    it('bounds every invocation with a timeout and an output ceiling', async () => {
      routeCodex(() => pluginListing('installed, enabled'));
      const client = new CodexMCPClient();
      await client.isPluginInstalled();
      const [, , options] = execFileMock.mock.calls[0] as [
        string,
        string[],
        { timeout?: number; maxBuffer?: number },
      ];
      expect(options.timeout).toBeGreaterThan(0);
      expect(options.maxBuffer).toBeGreaterThan(1024 * 1024);
    });
  });

  describe('plugin install and removal', () => {
    // `plugin marketplace add` registers the catalog only; without the
    // `plugin add` the wizard reported success and the user got no skills.
    it('installs the plugin after registering the marketplace', async () => {
      routeCodex((cmd) =>
        cmd.startsWith('plugin list') ? pluginListing('not installed') : '',
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
      routeCodex((cmd) =>
        cmd.startsWith('plugin list') ? pluginListing('not installed') : '',
      );
      const client = new CodexMCPClient();

      await expect(client.installPlugin()).resolves.toEqual({ success: true });

      expect(codexCalls()).toContain('plugin add posthog@posthog');
    });

    it('does nothing when the plugin is already installed', async () => {
      routeCodex(() => pluginListing('installed, enabled'));
      const client = new CodexMCPClient();

      await expect(client.installPlugin()).resolves.toEqual({
        success: true,
        alreadyInstalled: true,
      });
      expect(codexCalls().some((c) => c.startsWith('plugin add'))).toBe(false);
    });

    it('reports a failing plugin add rather than claiming success', async () => {
      routeCodex((cmd) => {
        if (cmd.startsWith('plugin list'))
          return pluginListing('not installed');
        if (cmd.startsWith('plugin add')) return cliError('manifest rejected');
        return '';
      });
      const client = new CodexMCPClient();

      const result = await client.installPlugin();

      expect(result.success).toBe(false);
      expect(result.reason).toContain('manifest rejected');
    });

    it('removes the plugin and the marketplace it came from', async () => {
      readFileSyncMock.mockReturnValue('[marketplaces.posthog]\n');
      routeCodex((cmd) =>
        cmd.startsWith('plugin list')
          ? pluginListing('installed, enabled')
          : '',
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
      routeCodex((cmd) =>
        cmd.startsWith('plugin list') ? pluginListing('not installed') : '',
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
      routeCodex((cmd) =>
        cmd.startsWith('plugin list') ? pluginListing('not installed') : '',
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
