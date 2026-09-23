import { ClaudeCodeMCPClient } from '@steps/add-mcp-server-to-clients/clients/claude-code';
import { execSync, execFile } from 'child_process';
import { analytics } from '@utils/analytics';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
  execFile: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
}));

vi.mock('@utils/analytics', () => ({
  analytics: { captureException: vi.fn() },
}));

vi.mock('@utils/debug', () => ({
  debug: vi.fn(),
}));

/** `plugin list --json` payload, trimmed to the fields the client reads. */
const listed = (...ids: string[]) =>
  JSON.stringify(
    ids.map((id) => ({
      id,
      version: '1.1.63',
      scope: 'user',
      enabled: true,
    })),
  );

/** The same payload with `enabled` set per row, as `/plugin` leaves it. */
const listedWith = (...rows: [string, boolean][]) =>
  JSON.stringify(
    rows.map(([id, enabled]) => ({
      id,
      version: '1.1.63',
      scope: 'user',
      enabled,
    })),
  );

/** `marketplace list --json` payload, trimmed the same way. */
const marketplaces = (...names: string[]) =>
  JSON.stringify(
    names.map((name) => ({
      name,
      source: 'github',
      repo: 'PostHog/ai-plugin',
    })),
  );

/** A marketplace under our name, published from someone else's repository. */
const foreignMarketplace = (name: string, repo: string) =>
  JSON.stringify([{ name, source: 'github', repo }]);

/**
 * Match a contiguous argument run, so `plugin list` doesn't also match
 * `plugin marketplace list`.
 */
const isCmd = (cmd: string, ...parts: string[]) =>
  cmd.includes(parts.join(' '));

describe('ClaudeCodeMCPClient — plugin methods', () => {
  const execSyncMock = execSync as Mock;
  const execFileMock = execFile as unknown as Mock;

  /** Every `claude` invocation, in order, as its joined command. */
  const claudeCalls = () =>
    execFileMock.mock.calls.map(
      ([file, args]: [string, string[]]) => `${file} ${args.join(' ')}`,
    );

  type ExecFileCb = (e: Error | null, stdout: string, stderr: string) => void;

  /** The options argument every `claude` invocation is spawned with. */
  const execFileOptions = () =>
    execFileMock.mock.calls.map(
      ([, , options]: [string, string[], unknown]) => options,
    );

  /** Answer claude invocations by their joined args; return an Error to fail one. */
  const routeClaude = (handler: (cmd: string) => string | Error) => {
    execFileMock.mockImplementation(
      (
        _file: string,
        args: string[],
        optionsOrCb: unknown,
        maybeCb?: ExecFileCb,
      ) => {
        const cb = (maybeCb ?? optionsOrCb) as ExecFileCb;
        const out = handler(args.join(' '));
        if (out instanceof Error) cb(out, '', out.message);
        else cb(null, out, '');
      },
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Binary discovery is the one sync call, and stays sync.
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd === 'command -v claude') return Buffer.from('');
      return Buffer.from('');
    });
    routeClaude(() => '');
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
    it('returns true for the plugin installed from the PostHog marketplace', async () => {
      routeClaude((cmd) =>
        isCmd(cmd, 'plugin', 'list') ? listed('posthog@posthog') : '',
      );
      const client = new ClaudeCodeMCPClient();
      await expect(client.isPluginInstalled()).resolves.toBe(true);
    });

    it('returns true for the same plugin installed from any other marketplace', async () => {
      routeClaude((cmd) =>
        isCmd(cmd, 'plugin', 'list')
          ? listed('posthog@claude-plugins-official')
          : '',
      );
      const client = new ClaudeCodeMCPClient();
      await expect(client.isPluginInstalled()).resolves.toBe(true);
    });

    it('returns false for a different plugin whose name merely starts with posthog', async () => {
      routeClaude((cmd) =>
        isCmd(cmd, 'plugin', 'list') ? listed('posthog-extras@someone') : '',
      );
      const client = new ClaudeCodeMCPClient();
      await expect(client.isPluginInstalled()).resolves.toBe(false);
    });

    it('counts a disabled copy as installed, because removal still has to clear it', async () => {
      // `index.ts` asks this to decide whether there is anything to remove.
      // Answering false for a disabled plugin hides it from `mcp remove` and
      // leaves it on the machine forever.
      routeClaude((cmd) =>
        isCmd(cmd, 'plugin', 'list')
          ? listedWith(['posthog@posthog', false])
          : '',
      );
      const client = new ClaudeCodeMCPClient();
      await expect(client.isPluginInstalled()).resolves.toBe(true);
    });

    it('returns false when no plugins are installed', async () => {
      routeClaude((cmd) => (isCmd(cmd, 'plugin', 'list') ? listed() : ''));
      const client = new ClaudeCodeMCPClient();
      await expect(client.isPluginInstalled()).resolves.toBe(false);
    });

    it('falls back to scanning plain output when --json is unsupported', async () => {
      routeClaude((cmd) => {
        if (isCmd(cmd, '--json'))
          return new Error("error: unknown option '--json'");
        if (isCmd(cmd, 'plugin', 'list')) return '  posthog@posthog\n';
        return '';
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.isPluginInstalled()).resolves.toBe(true);
    });

    it('returns false when the plugin list command fails outright', async () => {
      routeClaude(() => new Error('command failed'));
      const client = new ClaudeCodeMCPClient();
      await expect(client.isPluginInstalled()).resolves.toBe(false);
    });
  });

  describe('installPlugin', () => {
    // The CLI calls clone git repos and take seconds. execSync blocks the event
    // loop, which freezes the TUI spinner on its first frame — so this path must
    // use the async child-process API.
    it('runs the CLI without blocking the event loop', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'command -v claude') return Buffer.from('');
        throw new Error('installPlugin must not shell out synchronously');
      });
      routeClaude((cmd) => {
        if (isCmd(cmd, 'plugin', 'list')) return listed();
        if (isCmd(cmd, 'marketplace', 'list')) return marketplaces('posthog');
        return '';
      });
      const client = new ClaudeCodeMCPClient();

      await expect(client.installPlugin()).resolves.toEqual({ success: true });

      // `command -v claude` is the only sync call left (binary discovery).
      expect(
        execSyncMock.mock.calls.filter(([c]) => c !== 'command -v claude'),
      ).toEqual([]);
      expect(execFileMock).toHaveBeenCalled();
    });

    // A marketplace clone that stalls on a credential prompt never calls back,
    // so without a timeout the wizard waits on it forever with the spinner
    // frozen. The buffer cap is the same story from the other side: a verbose
    // clone past the 1 MB default kills the child and reads as a rejection.
    it('bounds every CLI call with a timeout and an output cap', async () => {
      routeClaude((cmd) => {
        if (isCmd(cmd, 'plugin', 'list')) return listed();
        if (isCmd(cmd, 'marketplace', 'list')) return marketplaces('posthog');
        return '';
      });
      const client = new ClaudeCodeMCPClient();

      await client.installPlugin();

      expect(execFileOptions().length).toBeGreaterThan(0);
      for (const options of execFileOptions()) {
        expect(options).toEqual(
          expect.objectContaining({
            timeout: 120_000,
            maxBuffer: 16 * 1024 * 1024,
          }),
        );
      }
    });

    it('reports a stalled CLI as a timeout rather than an empty reason', async () => {
      routeClaude((cmd) => {
        if (isCmd(cmd, 'plugin', 'list')) return listed();
        if (isCmd(cmd, 'marketplace', 'list')) return marketplaces();
        if (isCmd(cmd, 'plugin', 'install')) {
          const killed = new Error(
            'Command failed: claude plugin install posthog@posthog',
          ) as Error & { killed: boolean };
          killed.killed = true;
          return killed;
        }
        return '';
      });
      const client = new ClaudeCodeMCPClient();

      const result = await client.installPlugin();

      expect(result.success).toBe(false);
      expect(result.reason).toMatch(/did not finish within/i);
      expect(result.reason).not.toMatch(/Command failed/i);
    });

    it.each([
      [
        'buffer overflow',
        Object.assign(new Error('maxBuffer exceeded'), {
          code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
          killed: true,
        }),
        'more output',
      ],
      [
        'private error',
        new Error(
          'failed /Users/example/.local/bin/claude: Bearer fake-test-token',
        ),
        'failed ~/.local/bin/claude: Bearer [redacted]',
      ],
    ])('sanitizes and classifies %s', async (_name, error, expected) => {
      routeClaude((cmd) => {
        if (isCmd(cmd, 'plugin', 'list')) return listed();
        if (isCmd(cmd, 'marketplace', 'list')) return marketplaces('posthog');
        return error;
      });
      const result = await new ClaudeCodeMCPClient().installPlugin();
      expect(result.success).toBe(false);
      expect(result.reason).toContain(expected);
      expect(
        JSON.stringify((analytics.captureException as Mock).mock.calls),
      ).not.toContain('/Users/example');
      expect(
        JSON.stringify((analytics.captureException as Mock).mock.calls),
      ).not.toContain('fake-test-token');
    });

    it('registers the PostHog marketplace before installing the qualified plugin', async () => {
      routeClaude((cmd) => {
        if (isCmd(cmd, 'plugin', 'list')) return listed();
        if (isCmd(cmd, 'marketplace', 'list')) return marketplaces();
        return '';
      });
      const client = new ClaudeCodeMCPClient();

      await expect(client.installPlugin()).resolves.toEqual({ success: true });

      expect(claudeCalls()).toEqual([
        'claude plugin list --json',
        'claude plugin marketplace list --json',
        'claude plugin marketplace add PostHog/ai-plugin',
        'claude plugin install posthog@posthog',
      ]);
      expect(analytics.captureException).not.toHaveBeenCalled();
    });

    it('skips the marketplace add when the PostHog marketplace is already registered', async () => {
      routeClaude((cmd) => {
        if (isCmd(cmd, 'plugin', 'list')) return listed();
        if (isCmd(cmd, 'marketplace', 'list')) return marketplaces('posthog');
        return '';
      });
      const client = new ClaudeCodeMCPClient();

      await expect(client.installPlugin()).resolves.toEqual({ success: true });

      expect(claudeCalls()).toEqual([
        'claude plugin list --json',
        'claude plugin marketplace list --json',
        'claude plugin install posthog@posthog',
      ]);
    });

    it('refreshes a stale catalog and retries when the qualified plugin is not found', async () => {
      let installAttempts = 0;
      routeClaude((cmd) => {
        if (isCmd(cmd, 'plugin', 'list')) return listed();
        if (isCmd(cmd, 'marketplace', 'list')) return marketplaces('posthog');
        if (isCmd(cmd, 'install')) {
          installAttempts += 1;
          if (installAttempts === 1)
            return new Error(
              'Plugin "posthog" not found in any configured marketplace',
            );
        }
        return '';
      });
      const client = new ClaudeCodeMCPClient();

      await expect(client.installPlugin()).resolves.toEqual({ success: true });

      expect(claudeCalls()).toContain(
        'claude plugin marketplace update posthog',
      );
      expect(installAttempts).toBe(2);
      expect(analytics.captureException).not.toHaveBeenCalled();
    });

    it('falls back to the bare plugin name when the qualified one stays unresolvable', async () => {
      routeClaude((cmd) => {
        if (isCmd(cmd, 'plugin', 'list')) return listed();
        if (isCmd(cmd, 'marketplace', 'list')) return marketplaces('posthog');
        if (isCmd(cmd, 'install', 'posthog@posthog'))
          return new Error(
            'Plugin "posthog" not found in any configured marketplace',
          );
        return '';
      });
      const client = new ClaudeCodeMCPClient();

      await expect(client.installPlugin()).resolves.toEqual({ success: true });

      expect(claudeCalls()).toContain('claude plugin install posthog');
      expect(analytics.captureException).not.toHaveBeenCalled();
    });

    it('still installs, and reports nothing, when the marketplace add fails but the fallback works', async () => {
      routeClaude((cmd) => {
        if (isCmd(cmd, 'plugin', 'list')) return listed();
        if (isCmd(cmd, 'marketplace', 'list')) return marketplaces();
        if (isCmd(cmd, 'marketplace', 'add'))
          return new Error('network unreachable');
        if (isCmd(cmd, 'install', 'posthog@posthog'))
          return new Error(
            'Plugin "posthog" not found in any configured marketplace',
          );
        return '';
      });
      const client = new ClaudeCodeMCPClient();

      await expect(client.installPlugin()).resolves.toEqual({ success: true });
      expect(analytics.captureException).not.toHaveBeenCalled();
    });

    it('installs over a disabled plugin instead of reporting it already installed', async () => {
      // Disabled means installed but serving nothing, and Claude Code takes
      // its MCP server from the plugin. The CLI re-enables on install, so the
      // install has to actually run.
      routeClaude((cmd) => {
        if (isCmd(cmd, 'plugin', 'list'))
          return listedWith(['posthog@posthog', false]);
        if (isCmd(cmd, 'marketplace', 'list')) return marketplaces('posthog');
        return '';
      });
      const client = new ClaudeCodeMCPClient();

      await expect(client.installPlugin()).resolves.toEqual({ success: true });
      expect(claudeCalls()).toContainEqual(
        expect.stringContaining('plugin install posthog@posthog'),
      );
    });

    it('reports already installed when an enabled copy is present', async () => {
      routeClaude((cmd) =>
        isCmd(cmd, 'plugin', 'list')
          ? listedWith(
              ['posthog@posthog', false],
              ['posthog@claude-plugins-official', true],
            )
          : '',
      );
      const client = new ClaudeCodeMCPClient();

      await expect(client.installPlugin()).resolves.toEqual({
        success: true,
        alreadyInstalled: true,
      });
      expect(claudeCalls()).not.toContainEqual(
        expect.stringContaining('plugin install'),
      );
    });

    it('registers our marketplace when a foreign one holds the same name', async () => {
      routeClaude((cmd) => {
        if (isCmd(cmd, 'plugin', 'list')) return listed();
        if (isCmd(cmd, 'marketplace', 'list'))
          return foreignMarketplace('posthog', 'someone-else/ai-plugin');
        return '';
      });
      const client = new ClaudeCodeMCPClient();

      await expect(client.installPlugin()).resolves.toEqual({ success: true });
      expect(claudeCalls()).toContainEqual(
        expect.stringContaining('marketplace add PostHog/ai-plugin'),
      );
    });

    it('reports the marketplace add failure beside the install failure it caused', async () => {
      // `not found in any configured marketplace` is also what the pre-fix bug
      // produced, so the cause has to travel with it to stay distinguishable.
      routeClaude((cmd) => {
        if (isCmd(cmd, 'plugin', 'list')) return listed();
        if (isCmd(cmd, 'marketplace', 'list')) return marketplaces();
        if (isCmd(cmd, 'marketplace', 'add'))
          return new Error('network unreachable');
        return new Error(
          'Plugin "posthog" not found in any configured marketplace',
        );
      });
      const client = new ClaudeCodeMCPClient();

      await expect(client.installPlugin()).resolves.toMatchObject({
        success: false,
      });
      expect(analytics.captureException).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('not found in any configured'),
        }),
        expect.objectContaining({
          marketplaceFailure: expect.stringContaining('network unreachable'),
        }),
      );
    });

    it('returns success with alreadyInstalled when the CLI reports "already installed"', async () => {
      routeClaude((cmd) => {
        if (isCmd(cmd, 'plugin', 'list')) return listed();
        if (isCmd(cmd, 'marketplace', 'list')) return marketplaces('posthog');
        if (isCmd(cmd, 'install')) return new Error('already installed');
        return '';
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({
        success: true,
        alreadyInstalled: true,
      });
    });

    it('returns already-installed without running the install when the plugin is already there', async () => {
      routeClaude((cmd) =>
        isCmd(cmd, 'plugin', 'list') ? listed('posthog@posthog') : '',
      );
      const client = new ClaudeCodeMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({
        success: true,
        alreadyInstalled: true,
      });
      expect(claudeCalls().some((c) => isCmd(c, 'install'))).toBe(false);
    });

    it('returns failure with the reason and captures exception on unexpected error', async () => {
      routeClaude((cmd) => {
        if (isCmd(cmd, 'plugin', 'list')) return listed();
        if (isCmd(cmd, 'marketplace', 'list')) return marketplaces('posthog');
        if (isCmd(cmd, 'install')) return new Error('network timeout');
        return '';
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({
        success: false,
        reason: expect.stringContaining('network timeout'),
      });
      expect(analytics.captureException).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('network timeout'),
        }),
      );
    });

    it('returns failure with a reason when no binary is found', async () => {
      execSyncMock.mockImplementation(() => {
        throw new Error('not found');
      });
      const client = new ClaudeCodeMCPClient();
      await expect(client.installPlugin()).resolves.toEqual({
        success: false,
        reason: expect.stringContaining('PATH'),
      });
    });
  });

  describe('removePlugin', () => {
    it('uninstalls every installed posthog plugin, not just one', async () => {
      routeClaude((cmd) =>
        isCmd(cmd, 'plugin', 'list')
          ? listed('posthog@posthog', 'posthog@claude-plugins-official')
          : '',
      );
      const client = new ClaudeCodeMCPClient();

      await expect(client.removePlugin()).resolves.toEqual({ success: true });

      expect(claudeCalls()).toContain(
        'claude plugin uninstall posthog@posthog',
      );
      expect(claudeCalls()).toContain(
        'claude plugin uninstall posthog@claude-plugins-official',
      );
    });

    it('leaves an unrelated plugin alone', async () => {
      routeClaude((cmd) =>
        isCmd(cmd, 'plugin', 'list')
          ? listed('posthog@posthog', 'posthog-extras@someone')
          : '',
      );
      const client = new ClaudeCodeMCPClient();

      await client.removePlugin();

      expect(claudeCalls()).not.toContain(
        'claude plugin uninstall posthog-extras@someone',
      );
    });

    it('reports failure naming the id that could not be uninstalled', async () => {
      routeClaude((cmd) => {
        if (isCmd(cmd, 'plugin', 'list'))
          return listed('posthog@posthog', 'posthog@claude-plugins-official');
        if (isCmd(cmd, 'uninstall', 'posthog@posthog'))
          return new Error('permission denied');
        return '';
      });
      const client = new ClaudeCodeMCPClient();

      await expect(client.removePlugin()).resolves.toEqual({
        success: false,
        reason: expect.stringContaining('posthog@posthog'),
      });
    });

    it('falls back to the bare name when the id probe is unavailable', async () => {
      routeClaude((cmd) => {
        if (isCmd(cmd, '--json'))
          return new Error("error: unknown option '--json'");
        if (isCmd(cmd, 'plugin', 'list')) return 'posthog  1.1.63\n';
        return '';
      });
      const client = new ClaudeCodeMCPClient();

      await expect(client.removePlugin()).resolves.toEqual({ success: true });
      expect(claudeCalls()).toContain('claude plugin uninstall posthog');
    });

    it('uninstalls a disabled copy, which discovery must still surface', async () => {
      routeClaude((cmd) =>
        isCmd(cmd, 'plugin', 'list')
          ? listedWith(['posthog@posthog', false])
          : '',
      );
      const client = new ClaudeCodeMCPClient();

      await expect(client.removePlugin()).resolves.toEqual({ success: true });
      expect(claudeCalls()).toContainEqual(
        expect.stringContaining('plugin uninstall posthog@posthog'),
      );
    });

    it('removes our marketplace too, so removal does not leave half behind', async () => {
      routeClaude((cmd) => {
        if (isCmd(cmd, 'marketplace', 'list')) return marketplaces('posthog');
        if (isCmd(cmd, 'plugin', 'list')) return listed('posthog@posthog');
        return '';
      });
      const client = new ClaudeCodeMCPClient();

      await expect(client.removePlugin()).resolves.toEqual({ success: true });
      expect(claudeCalls()).toContainEqual(
        expect.stringContaining('plugin uninstall posthog@posthog'),
      );
      expect(claudeCalls()).toContainEqual(
        expect.stringContaining('marketplace remove posthog'),
      );
    });

    it('clears a marketplace left registered with no plugin', async () => {
      // The state `installPlugin` produced when its plugin step failed.
      routeClaude((cmd) => {
        if (isCmd(cmd, 'marketplace', 'list')) return marketplaces('posthog');
        if (isCmd(cmd, 'plugin', 'list')) return listed();
        return '';
      });
      const client = new ClaudeCodeMCPClient();

      await expect(client.removePlugin()).resolves.toEqual({ success: true });
      expect(claudeCalls()).toContainEqual(
        expect.stringContaining('marketplace remove posthog'),
      );
      expect(claudeCalls()).not.toContainEqual(
        expect.stringContaining('plugin uninstall'),
      );
    });

    it('leaves a foreign marketplace under our name registered', async () => {
      routeClaude((cmd) => {
        if (isCmd(cmd, 'marketplace', 'list'))
          return foreignMarketplace('posthog', 'someone-else/ai-plugin');
        if (isCmd(cmd, 'plugin', 'list')) return listed('posthog@posthog');
        return '';
      });
      const client = new ClaudeCodeMCPClient();

      await expect(client.removePlugin()).resolves.toEqual({ success: true });
      expect(claudeCalls()).not.toContainEqual(
        expect.stringContaining('marketplace remove'),
      );
    });

    it('reports nothing to do when no posthog plugin is installed', async () => {
      routeClaude((cmd) =>
        isCmd(cmd, 'plugin', 'list') ? listed('other@somewhere') : '',
      );
      const client = new ClaudeCodeMCPClient();

      await expect(client.removePlugin()).resolves.toEqual({
        success: true,
        alreadyInstalled: true,
      });
      expect(claudeCalls().some((c) => isCmd(c, 'uninstall'))).toBe(false);
    });
  });
});
