import { DefaultMCPClient } from '@steps/add-mcp-server-to-clients/MCPClient';
import {
  DefaultMCPClientConfig,
  buildMCPUrl,
} from '@steps/add-mcp-server-to-clients/defaults';
import {
  PluginCapable,
  PluginInstallResult,
} from '@steps/add-mcp-server-to-clients/plugin-client';
import {
  redactSecrets,
  type InstallResult,
} from '@steps/add-mcp-server-to-clients/results';
import { LoginCapable } from '@steps/add-mcp-server-to-clients/login-client';
import { z } from 'zod';
import { execSync, execFile } from 'child_process';
import { analytics } from '@utils/analytics';
import { debug } from '@utils/debug';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

export const ClaudeCodeMCPConfig = DefaultMCPClientConfig;

export type ClaudeCodeMCPConfig = z.infer<typeof DefaultMCPClientConfig>;

// `plugin install <name>` only resolves against marketplaces the user already
// registered, and the wizard never opens Claude Code interactively — so without
// the add below the install dies with `not found in any configured marketplace`.
// Our own marketplace, not Anthropic's: that one carries us as a pinned sha, so
// installing through it would gate plugin releases on Anthropic bumping the pin.
const PLUGIN_NAME = 'posthog';
const PLUGIN_MARKETPLACE = 'posthog';
const PLUGIN_MARKETPLACE_SOURCE = 'PostHog/ai-plugin';
const PLUGIN_REF = `${PLUGIN_NAME}@${PLUGIN_MARKETPLACE}`;

/** The plugin is missing from every catalog the CLI can currently see. */
const NOT_IN_A_MARKETPLACE = /not found in/i;

/** One `plugin list --json` row; the CLI returns more fields than we read. */
interface ListedPlugin {
  /** `<plugin>@<marketplace>`, e.g. `posthog@posthog`. */
  id: string;
}

interface ListedMarketplace {
  name: string;
}

type ClaudeRun = { ok: boolean; output: string };

export class ClaudeCodeMCPClient
  extends DefaultMCPClient
  implements PluginCapable, LoginCapable
{
  name = 'Claude Code';
  private claudeBinaryPath: string | null = null;

  constructor() {
    super();
  }

  private findClaudeBinary(): string | null {
    if (this.claudeBinaryPath) {
      return this.claudeBinaryPath;
    }

    // Common installation paths for Claude Code CLI
    const possiblePaths = [
      path.join(os.homedir(), '.claude', 'local', 'claude'),
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
    ];

    for (const claudePath of possiblePaths) {
      if (fs.existsSync(claudePath)) {
        debug(`  Found claude binary at: ${claudePath}`);
        this.claudeBinaryPath = claudePath;
        return claudePath;
      }
    }

    // Try PATH as fallback
    try {
      execSync('command -v claude', { stdio: 'pipe' });
      debug('  Found claude in PATH');
      this.claudeBinaryPath = 'claude';
      return 'claude';
    } catch {
      // Not in PATH
    }

    return null;
  }

  isClientSupported(): Promise<boolean> {
    try {
      debug('  Checking for Claude Code...');
      const claudeBinary = this.findClaudeBinary();

      if (!claudeBinary) {
        debug('  Claude Code not found. Installation paths checked:');
        debug(`    - ${path.join(os.homedir(), '.claude', 'local', 'claude')}`);
        debug(`    - /usr/local/bin/claude`);
        debug(`    - /opt/homebrew/bin/claude`);
        debug(`    - PATH`);
        return Promise.resolve(false);
      }

      const output = execSync(`${claudeBinary} --version`, { stdio: 'pipe' });
      const version = output.toString().trim();
      debug(`  Claude Code detected: ${version}`);
      return Promise.resolve(true);
    } catch (error) {
      debug(
        `  Claude Code check failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return Promise.resolve(false);
    }
  }

  isServerInstalled(local?: boolean): Promise<boolean> {
    const binary = this.findClaudeBinary();
    if (!binary) return Promise.resolve(false);
    const serverName = local ? 'posthog-local' : 'posthog';
    // `mcp get <name>` exits non-zero when the entry doesn't exist. A substring
    // scan of `mcp list` also matches the claude.ai "PostHog" connector and the
    // plugin's `plugin:posthog:posthog`, reporting installed forever.
    try {
      execSync(`${binary} mcp get ${serverName}`, { stdio: 'pipe' });
      return Promise.resolve(true);
    } catch {
      return Promise.resolve(false);
    }
  }

  getConfigPath(): Promise<string> {
    throw new Error('Not implemented');
  }

  addServer(
    apiKey?: string,
    selectedFeatures?: string[],
    local?: boolean,
  ): Promise<InstallResult> {
    const binary = this.findClaudeBinary();
    if (!binary)
      return Promise.resolve({
        success: false,
        reason: 'The claude CLI is no longer on your PATH.',
      });

    const serverName = local ? 'posthog-local' : 'posthog';
    const url = buildMCPUrl(selectedFeatures, local);
    const args = [
      'mcp',
      'add',
      '--transport',
      'http',
      '--scope',
      'user',
      serverName,
      url,
    ];
    if (apiKey) {
      args.push('--header', `Authorization: Bearer ${apiKey}`);
    }

    try {
      execSync(`${binary} ${args.map((a) => JSON.stringify(a)).join(' ')}`, {
        stdio: 'pipe',
      });
      return Promise.resolve({ success: true });
    } catch (error) {
      // The failing command echoes back the Authorization header we passed, so
      // redact before this reaches a log, the screen, or an exception report.
      const msg = redactSecrets(
        error instanceof Error ? error.message : String(error),
      );
      if (msg.includes('already exists')) {
        return Promise.resolve({ success: true, alreadyInstalled: true });
      }
      analytics.captureException(
        new Error(`Claude Code MCP add failed: ${msg}`),
      );
      return Promise.resolve({ success: false, reason: msg });
    }
  }

  /** Claude Code's own login runs its OAuth and owns the token; the wizard only surfaces the command. */
  loginCommand(local?: boolean): string {
    return `claude mcp login ${local ? 'posthog-local' : 'posthog'}`;
  }

  /** The plugin bundles its own `posthog` server, addressed as `plugin:<plugin>:<server>`. */
  pluginLoginCommand(): string {
    return 'claude mcp login plugin:posthog:posthog';
  }

  async removePlugin(): Promise<PluginInstallResult> {
    const binary = this.findClaudeBinary();
    if (!binary)
      return {
        success: false,
        reason: 'The claude CLI is no longer on your PATH.',
      };

    // `plugin uninstall posthog` removes exactly one match, so with both
    // `posthog@posthog` and `posthog@claude-plugins-official` installed the bare
    // call leaves the other copy enabled — and `mcp remove` would be lying.
    const ids = await this.installedPluginIds(binary);
    if (ids?.length === 0) {
      return { success: true, alreadyInstalled: true };
    }
    if (ids === null && !(await this.isPluginInstalled())) {
      return { success: true, alreadyInstalled: true };
    }

    const targets = ids?.length ? ids : [PLUGIN_NAME];
    const failures: string[] = [];
    for (const target of targets) {
      const run = await this.runClaude(binary, ['plugin', 'uninstall', target]);
      if (!run.ok) failures.push(`${target}: ${run.output}`);
    }

    if (failures.length === 0) return { success: true };

    const reason = failures.join('; ');
    analytics.captureException(
      new Error(`Claude Code plugin uninstall failed: ${reason}`),
    );
    return { success: false, reason };
  }

  removeServer(local?: boolean): Promise<InstallResult> {
    const claudeBinary = this.findClaudeBinary();
    if (!claudeBinary) {
      return Promise.resolve({
        success: false,
        reason: 'The claude CLI is no longer on your PATH.',
      });
    }

    const serverName = local ? 'posthog-local' : 'posthog';
    const command = `${claudeBinary} mcp remove --scope user ${serverName}`;

    try {
      execSync(command, { stdio: 'pipe' });
    } catch (error) {
      const reason = redactSecrets(
        error instanceof Error ? error.message : String(error),
      );
      // Removing something that isn't there is the requested end state, not a
      // failure to report.
      if (/no( such)? mcp server|not found/i.test(reason)) {
        return Promise.resolve({ success: true, alreadyInstalled: true });
      }
      analytics.captureException(
        new Error(`Failed to remove server from Claude Code: ${reason}`),
      );
      return Promise.resolve({ success: false, reason });
    }

    return Promise.resolve({ success: true });
  }

  /** The plugin ships mcp.json with the posthog server — no direct entry needed. */
  pluginBundlesMcpServer(): boolean {
    return true;
  }

  supportsPlugin(): boolean {
    return this.findClaudeBinary() !== null;
  }

  // Async on purpose: these calls clone git repos and take seconds, and
  // execSync would block the event loop and freeze the TUI spinner. Never
  // throws; the caller decides what a failure means.
  private runClaude(binary: string, args: string[]): Promise<ClaudeRun> {
    return new Promise((resolve) => {
      execFile(binary, args, (error, stdout) => {
        if (!error)
          return resolve({ ok: true, output: stdout?.toString() ?? '' });
        // execFile puts `Command failed: <cmd>` and stderr in the message, the
        // same text execSync produced, so failure matching is unchanged.
        resolve({ ok: false, output: error.message });
      });
    });
  }

  /** Null when `--json` is unsupported, the command failed, or output didn't parse — never "nothing installed". */
  private async listJson<T>(
    binary: string,
    args: string[],
  ): Promise<T[] | null> {
    const result = await this.runClaude(binary, [...args, '--json']);
    if (!result.ok) return null;
    try {
      const parsed: unknown = JSON.parse(result.output);
      return Array.isArray(parsed) ? (parsed as T[]) : null;
    } catch {
      return null;
    }
  }

  // Every installed copy, from any marketplace: Claude Code permits
  // `posthog@posthog` and `posthog@claude-plugins-official` at the same time.
  // Null means the probe is unavailable, which is not the same as none.
  private async installedPluginIds(binary: string): Promise<string[] | null> {
    const listed = await this.listJson<ListedPlugin>(binary, [
      'plugin',
      'list',
    ]);
    if (!listed) return null;
    return listed
      .map((p) => p?.id)
      .filter((id): id is string => typeof id === 'string')
      .filter((id) => id.split('@')[0] === PLUGIN_NAME);
  }

  async isPluginInstalled(): Promise<boolean> {
    const binary = this.findClaudeBinary();
    if (!binary) return false;

    const ids = await this.installedPluginIds(binary);
    if (ids) return ids.length > 0;

    // Older CLI without `--json`. A substring scan also matches a plugin merely
    // named `posthog-something`, which is why it's the fallback and not the path.
    const plain = await this.runClaude(binary, ['plugin', 'list']);
    return plain.ok && plain.output.toLowerCase().includes(PLUGIN_NAME);
  }

  async installPlugin(): Promise<PluginInstallResult> {
    const binary = this.findClaudeBinary();
    if (!binary)
      return {
        success: false,
        reason: 'The claude CLI is no longer on your PATH.',
      };

    // Ask before installing so a re-run reports "already installed" rather than
    // relying on the CLI's error text to spot the no-op.
    if (await this.isPluginInstalled()) {
      return { success: true, alreadyInstalled: true };
    }

    await this.ensurePluginMarketplace(binary);

    let result = await this.runClaude(binary, [
      'plugin',
      'install',
      PLUGIN_REF,
    ]);

    // A registered but stale catalog still reports the plugin as missing.
    if (!result.ok && NOT_IN_A_MARKETPLACE.test(result.output)) {
      await this.runClaude(binary, [
        'plugin',
        'marketplace',
        'update',
        PLUGIN_MARKETPLACE,
      ]);
      result = await this.runClaude(binary, ['plugin', 'install', PLUGIN_REF]);
    }

    // Last resort: let Claude Code resolve the bare name against whatever the
    // user does have, the way the wizard always did. Never worse than before.
    if (!result.ok && NOT_IN_A_MARKETPLACE.test(result.output)) {
      result = await this.runClaude(binary, ['plugin', 'install', PLUGIN_NAME]);
    }

    if (result.ok) return { success: true };

    const msg = result.output;
    if (msg.includes('already installed') || msg.includes('already exists')) {
      return { success: true, alreadyInstalled: true };
    }
    analytics.captureException(
      new Error(`Claude Code plugin install failed: ${msg}`),
    );
    return { success: false, reason: msg };
  }

  // Best-effort: a failure here only matters if the install also fails, since
  // the user may hold the plugin in another catalog that the fallback finds.
  private async ensurePluginMarketplace(binary: string): Promise<void> {
    const listed = await this.listJson<ListedMarketplace>(binary, [
      'plugin',
      'marketplace',
      'list',
    ]);
    if (listed?.some((m) => m?.name === PLUGIN_MARKETPLACE)) {
      debug(`  Marketplace ${PLUGIN_MARKETPLACE} already registered`);
      return;
    }

    // `marketplace add` is idempotent on Claude Code and exits 0 when the
    // marketplace is already on disk, so there's no "already added" text to
    // special-case here — unlike the Codex CLI, where it exits non-zero.
    const added = await this.runClaude(binary, [
      'plugin',
      'marketplace',
      'add',
      PLUGIN_MARKETPLACE_SOURCE,
    ]);
    if (!added.ok) debug(`  Marketplace add failed: ${added.output}`);
  }
}
