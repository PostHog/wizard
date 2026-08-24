import { z } from 'zod';
import { execSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { LoginCapable } from '@steps/add-mcp-server-to-clients/login-client';
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

import { analytics } from '@utils/analytics';

/** Wording codex uses when the thing we're adding is already registered. */
const ALREADY_INSTALLED_PATTERN =
  /already (installed|exists|added|registered)/i;
/** Wording that means the opposite: a cache entry exists but the plugin doesn't. */
const STALE_MARKETPLACE_CACHE = /already added from a different source/i;

export const CodexMCPConfig = DefaultMCPClientConfig;

export type CodexMCPConfig = z.infer<typeof DefaultMCPClientConfig>;

export class CodexMCPClient
  extends DefaultMCPClient
  implements PluginCapable, LoginCapable
{
  name = 'Codex';
  private codexBinaryPath: string | null = null;

  constructor() {
    super();
  }

  private findCodexBinary(): string | null {
    if (this.codexBinaryPath) return this.codexBinaryPath;
    try {
      const resolved = execSync('command -v codex', { stdio: 'pipe' })
        .toString()
        .trim();
      if (resolved) {
        this.codexBinaryPath = resolved;
        return resolved;
      }
    } catch {
      // not in PATH
    }
    return null;
  }

  private configPath(): string {
    return path.join(os.homedir(), '.codex', 'config.toml');
  }

  isClientSupported(): Promise<boolean> {
    return Promise.resolve(this.findCodexBinary() !== null);
  }

  getConfigPath(): Promise<string> {
    throw new Error('Not implemented');
  }

  isServerInstalled(local?: boolean): Promise<boolean> {
    const serverName = local ? 'posthog-local' : 'posthog';
    // Exact `[mcp_servers.<name>]` section in config.toml — both the CLI and
    // the desktop app read (and `codex mcp add` writes) this file, and a
    // substring scan of `mcp list` matches unrelated posthog-ish servers.
    try {
      const contents = fs.readFileSync(this.configPath(), 'utf-8');
      return Promise.resolve(contents.includes(`[mcp_servers.${serverName}]`));
    } catch {
      return Promise.resolve(false);
    }
  }

  addServer(
    apiKey?: string,
    selectedFeatures?: string[],
    local?: boolean,
  ): Promise<InstallResult> {
    const serverName = local ? 'posthog-local' : 'posthog';
    const url = buildMCPUrl(selectedFeatures, local);

    // Api-key installs go through the CLI for its bearer-token env wiring.
    if (apiKey) {
      const binary = this.findCodexBinary();
      if (!binary)
        return Promise.resolve({
          success: false,
          reason: 'An API-key install into Codex needs the codex CLI.',
        });
      const args = [
        'mcp',
        'add',
        serverName,
        '--url',
        url,
        '--bearer-token-env-var',
        'POSTHOG_AUTH_HEADER',
      ];
      const env = { ...process.env, POSTHOG_AUTH_HEADER: `Bearer ${apiKey}` };
      const result = spawnSync(binary, args, { encoding: 'utf-8', env });
      if (result.status !== 0) {
        const stderr = result.stderr ?? '';
        if (ALREADY_INSTALLED_PATTERN.test(stderr)) {
          return Promise.resolve({ success: true, alreadyInstalled: true });
        }
        const reason = redactSecrets(stderr);
        analytics.captureException(
          new Error(`Codex MCP add failed: ${reason}`),
        );
        return Promise.resolve({ success: false, reason });
      }
      return Promise.resolve({ success: true });
    }

    // OAuth installs write config.toml directly: running `codex mcp add` here
    // would hang the wizard on its built-in OAuth browser wait. Codex nags
    // about the unauthenticated server until the surfaced `codex mcp login`
    // runs — the same interim state as Claude Code's "needs authentication".
    return Promise.resolve(this.writeServerSection(serverName, url));
  }

  private hasServerSection(serverName: string): boolean {
    try {
      return fs
        .readFileSync(this.configPath(), 'utf-8')
        .includes(`[mcp_servers.${serverName}]`);
    } catch {
      return false;
    }
  }

  /** Append or update the `[mcp_servers.<name>]` section in config.toml. */
  private writeServerSection(serverName: string, url: string): InstallResult {
    const header = `[mcp_servers.${serverName}]`;
    try {
      const contents = fs.readFileSync(this.configPath(), 'utf-8');
      if (contents.includes(header)) {
        if (contents.includes(`${header}\nurl = "${url}"`)) {
          return { success: true, alreadyInstalled: true };
        }
        const section = new RegExp(
          `(\\[mcp_servers\\.${serverName}\\]\\n)url = "[^"]*"`,
        );
        fs.writeFileSync(
          this.configPath(),
          contents.replace(section, `$1url = "${url}"`),
        );
        return { success: true };
      }
      const suffix = contents.endsWith('\n') ? '' : '\n';
      // 30s startup budget: codex gives servers 10s to finish the MCP
      // initialize handshake, and the remote OAuth handshake can exceed that
      // on cold start — the "servers were not initialized" warning.
      fs.appendFileSync(
        this.configPath(),
        `${suffix}\n${header}\nurl = "${url}"\nstartup_timeout_sec = 30\n`,
      );
      return { success: true };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      analytics.captureException(
        new Error(`Codex config.toml write failed: ${reason}`),
      );
      return { success: false, reason };
    }
  }

  /** Codex's own login runs its OAuth and owns the token; the wizard only surfaces the command. */
  loginCommand(local?: boolean): string | null {
    if (!this.findCodexBinary()) return null;
    return `codex mcp login ${local ? 'posthog-local' : 'posthog'}`;
  }

  removeServer(local?: boolean): Promise<InstallResult> {
    const binary = this.findCodexBinary();
    if (!binary)
      return Promise.resolve({
        success: false,
        reason: 'The codex CLI is no longer on your PATH.',
      });

    // `local` was ignored here, so `mcp remove --local` reported success while
    // leaving the posthog-local server in place.
    const serverName = local ? 'posthog-local' : 'posthog';
    const result = spawnSync(binary, ['mcp', 'remove', serverName], {
      encoding: 'utf-8',
    });

    if (result.error || result.status !== 0) {
      const reason = redactSecrets(
        result.error?.message ?? result.stderr ?? 'codex mcp remove failed',
      );
      analytics.captureException(
        new Error(`Failed to remove server from Codex CLI: ${reason}`),
      );
      return Promise.resolve({ success: false, reason });
    }

    return Promise.resolve({ success: true });
  }

  /** The codex marketplace plugin ships skills only — the MCP server needs its own entry. */
  pluginBundlesMcpServer(): boolean {
    return false;
  }

  supportsPlugin(): boolean {
    return this.findCodexBinary() !== null;
  }

  isPluginInstalled(): Promise<boolean> {
    const configPath = path.join(os.homedir(), '.codex', 'config.toml');
    try {
      const contents = fs.readFileSync(configPath, 'utf-8');
      // Marketplace installs appear as [marketplaces.posthog] in config.toml
      return Promise.resolve(
        contents.toLowerCase().includes('[marketplaces.posthog]'),
      );
    } catch {
      return Promise.resolve(false);
    }
  }

  async removePlugin(): Promise<PluginInstallResult> {
    const binary = this.findCodexBinary();
    if (!binary)
      return {
        success: false,
        reason: 'The codex CLI is no longer on your PATH.',
      };

    if (!(await this.isPluginInstalled())) {
      return { success: true, alreadyInstalled: true };
    }

    const result = spawnSync(
      binary,
      ['plugin', 'marketplace', 'remove', 'posthog'],
      { encoding: 'utf-8' },
    );
    if (result.status !== 0) {
      const reason = redactSecrets(
        result.stderr ?? 'codex plugin marketplace remove failed',
      );
      analytics.captureException(
        new Error(`Codex plugin uninstall failed: ${reason}`),
      );
      return { success: false, reason };
    }
    return { success: true };
  }

  async installPlugin(): Promise<PluginInstallResult> {
    const binary = this.findCodexBinary();
    if (!binary)
      return {
        success: false,
        reason: 'The codex CLI is no longer on your PATH.',
      };

    // `codex plugin marketplace add` exits non-zero once the marketplace is
    // registered, so ask config.toml first. Without this the second run of
    // `mcp add` looked like a failure and reported nothing at all.
    if (await this.isPluginInstalled()) {
      return { success: true, alreadyInstalled: true };
    }

    const run = () =>
      spawnSync(binary, ['plugin', 'marketplace', 'add', 'PostHog/ai-plugin'], {
        encoding: 'utf-8',
      });

    let result = run();

    // Stale cache directory with no config.toml entry — clear it and retry
    if (
      result.status !== 0 &&
      STALE_MARKETPLACE_CACHE.test(result.stderr ?? '')
    ) {
      const staleDir = path.join(
        os.homedir(),
        '.codex',
        '.tmp',
        'marketplaces',
        'posthog',
      );
      try {
        fs.rmSync(staleDir, { recursive: true, force: true });
      } catch {
        // ignore — retry anyway
      }
      result = run();
    }

    if (result.status !== 0) {
      const stderr = result.stderr ?? '';
      // The marketplace was registered by something other than us (a manual
      // `codex plugin marketplace add`, or a version that writes config.toml
      // differently) — that's still "already installed", not a failure. The
      // stale-cache wording above is deliberately excluded: that one means the
      // plugin is NOT registered, and it only reaches here if the retry failed.
      if (
        ALREADY_INSTALLED_PATTERN.test(stderr) &&
        !STALE_MARKETPLACE_CACHE.test(stderr)
      ) {
        return { success: true, alreadyInstalled: true };
      }
      const reason = redactSecrets(stderr);
      analytics.captureException(
        new Error(`Codex plugin install failed: ${reason}`),
      );
      return { success: false, reason };
    }

    return { success: true };
  }
}

export default CodexMCPClient;
