import { z } from 'zod';
import { execSync, spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
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
  scrubHomePaths,
  expectedFailureHint,
  type ExpectedFailure,
  type InstallResult,
} from '@steps/add-mcp-server-to-clients/results';

import { analytics } from '@utils/analytics';

const PLUGIN_MARKETPLACE = 'posthog';
const PLUGIN_MARKETPLACE_SOURCE = 'PostHog/ai-plugin';
const PLUGIN_REF = `posthog@${PLUGIN_MARKETPLACE}`;

/**
 * The plugin's row in `codex plugin list`, whose STATUS column reads
 * `installed, enabled` or `not installed`. Registering the marketplace only
 * publishes the catalog, so the marketplace section in config.toml says nothing
 * about whether the plugin itself is there.
 */
const listedAsInstalled = (stdout: string): boolean => {
  const row = new RegExp(`^${PLUGIN_REF}\\s+(.*)$`, 'm').exec(stdout)?.[1];
  return !!row && /\binstalled\b/.test(row) && !/\bnot installed\b/.test(row);
};

/**
 * Failures in the user's own environment. Reporting them files issues nobody
 * can action, so hand back a hint instead. Drawn from what the codex install
 * path actually produced in the field.
 */
const EXPECTED_FAILURES: ExpectedFailure[] = [
  {
    match:
      /unexpected argument|unknown (command|option|argument)|Missing option/i,
    hint: 'your codex CLI is too old for plugins — update codex, then run `codex plugin marketplace add PostHog/ai-plugin`',
  },
  {
    match: /ENOENT|not found in PATH|spawn .* ENOENT/i,
    hint: 'your codex install looks broken — reinstall codex, then run `codex plugin marketplace add PostHog/ai-plugin`',
  },
  {
    match:
      /failed to load (bootstrap )?configuration|invalid type|is no longer supported|must contain at least one|OPENAI_API_KEY|Missing OpenAI API key/i,
    hint: 'codex could not read its own config — fix what it reports in ~/.codex/config.toml, then retry',
  },
  {
    match:
      /EACCES|EPERM|permission denied|read-only file system|not permitted/i,
    hint: 'codex could not write to its config — fix the permissions on ~/.codex, then retry',
  },
  {
    match: /ENOSPC|no space left/i,
    hint: 'the disk is full — free some space, then retry',
  },
  {
    match:
      /git clone .* failed|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|could not resolve host/i,
    hint: 'codex could not reach GitHub to download the plugin — check your network, then retry',
  },
];

/**
 * spawnSync splits the cause across error, stderr and stdout, and sets none of
 * them when the process merely exits non-zero. Reading stderr alone reported a
 * blank reason to the user and filed an exception carrying nothing.
 */
const describeSpawn = (result: SpawnSyncReturns<string>): string => {
  const parts = [result.error?.message, result.stderr, result.stdout]
    .map((p) => (p ? String(p).trim() : ''))
    .filter(Boolean);
  return redactSecrets(
    parts.join('\n') || `codex exited with status ${String(result.status)}`,
  );
};

/**
 * Turn a failed spawn into a result: an expected local failure becomes a hint,
 * anything else is reported under a constant message so one root cause stays
 * one issue, with the varying detail in properties.
 */
const reportSpawnFailure = (stage: string, details: string): InstallResult => {
  const hint = expectedFailureHint(details, EXPECTED_FAILURES);
  if (hint) return { success: false, reason: hint };
  analytics.captureException(new Error(`Codex ${stage} failed`), {
    stage,
    details: scrubHomePaths(details),
  });
  return { success: false, reason: details };
};

/** Wording codex uses when the thing we're adding is already registered. */
const ALREADY_INSTALLED_PATTERN =
  /already (installed|exists|added|registered)/i;
/** Wording that means the opposite: a cache entry exists but the plugin doesn't. */
const STALE_MARKETPLACE_CACHE = /already added from a different source/i;

/**
 * Codex allows servers 10s to finish the MCP initialize handshake, and a remote
 * OAuth handshake can exceed that on a cold start — the "servers were not
 * initialized" warning.
 */
const STARTUP_TIMEOUT_SEC = 30;

/**
 * The server's table header. TOML accepts a bare or quoted key for the same
 * table, and matching only the bare form means we append a second definition of
 * a table that already exists — a duplicate-key error that takes the user's
 * whole config down, not just PostHog's entry.
 */
const sectionHeader = (serverName: string): RegExp =>
  new RegExp(
    `^\\[mcp_servers\\.(?:${serverName}|"${serverName}")\\][ \\t]*$`,
    'm',
  );

/**
 * Set `key = value` inside a section body, inserting it when absent. Scans the
 * whole body rather than the line after the header: TOML does not care about
 * key order, and assuming it does means silently matching nothing.
 */
const setKey = (body: string, key: string, value: string): string => {
  const existing = new RegExp(`^[ \\t]*${key}[ \\t]*=.*$`, 'm');
  return existing.test(body)
    ? body.replace(existing, `${key} = ${value}`)
    : `\n${key} = ${value}${body}`;
};

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
    // The `[mcp_servers.<name>]` section in config.toml — both the CLI and the
    // desktop app read (and `codex mcp add` writes) this file, and a substring
    // scan of `mcp list` matches unrelated posthog-ish servers.
    try {
      const contents = fs.readFileSync(this.configPath(), 'utf-8');
      return Promise.resolve(sectionHeader(serverName).test(contents));
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
      if (result.error || result.status !== 0) {
        const details = describeSpawn(result);
        if (ALREADY_INSTALLED_PATTERN.test(details)) {
          return Promise.resolve({ success: true, alreadyInstalled: true });
        }
        return Promise.resolve(reportSpawnFailure('MCP add', details));
      }
      return Promise.resolve({ success: true });
    }

    // OAuth installs write config.toml directly: running `codex mcp add` here
    // would hang the wizard on its built-in OAuth browser wait. Codex nags
    // about the unauthenticated server until the surfaced `codex mcp login`
    // runs — the same interim state as Claude Code's "needs authentication".
    return Promise.resolve(this.writeServerSection(serverName, url));
  }

  /**
   * Create or update the `[mcp_servers.<name>]` section in config.toml, editing
   * in place so the user's other servers, key order, and comments survive.
   */
  private writeServerSection(serverName: string, url: string): InstallResult {
    const configPath = this.configPath();
    try {
      // A machine that has codex installed but has never run it has no
      // ~/.codex at all — `codex mcp add` used to create it for us.
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      const contents = fs.existsSync(configPath)
        ? fs.readFileSync(configPath, 'utf-8')
        : '';

      const header = sectionHeader(serverName).exec(contents);
      if (!header) {
        const gap = contents === '' || contents.endsWith('\n\n') ? '' : '\n';
        const pad = contents === '' || contents.endsWith('\n') ? '' : '\n';
        this.write(
          configPath,
          `${contents}${pad}${gap}[mcp_servers.${serverName}]\n` +
            `url = "${url}"\nstartup_timeout_sec = ${STARTUP_TIMEOUT_SEC}\n`,
        );
        return { success: true };
      }

      // Everything up to the next table header belongs to this server.
      const start = header.index + header[0].length;
      const rest = contents.slice(start);
      const next = /^\[/m.exec(rest);
      const end = next ? start + next.index : contents.length;

      const body = contents.slice(start, end);
      const updated = setKey(
        setKey(body, 'url', `"${url}"`),
        'startup_timeout_sec',
        String(STARTUP_TIMEOUT_SEC),
      );
      if (updated === body) return { success: true, alreadyInstalled: true };

      this.write(
        configPath,
        contents.slice(0, start) + updated + contents.slice(end),
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

  /** Write via a sibling temp file: a crash mid-write must not truncate the config. */
  private write(configPath: string, contents: string): void {
    const tmp = `${configPath}.wizard-tmp`;
    fs.writeFileSync(tmp, contents);
    fs.renameSync(tmp, configPath);
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
    const binary = this.findCodexBinary();
    if (!binary) return Promise.resolve(false);
    const result = spawnSync(
      binary,
      ['plugin', 'list', '-m', PLUGIN_MARKETPLACE],
      { encoding: 'utf-8' },
    );
    if (result.error || result.status !== 0) return Promise.resolve(false);
    return Promise.resolve(listedAsInstalled(result.stdout ?? ''));
  }

  /** The catalog, which the plugin is installed *from* — not the plugin. */
  private isMarketplaceRegistered(): boolean {
    try {
      const contents = fs.readFileSync(this.configPath(), 'utf-8');
      return contents
        .toLowerCase()
        .includes(`[marketplaces.${PLUGIN_MARKETPLACE}]`);
    } catch {
      return false;
    }
  }

  async removePlugin(): Promise<PluginInstallResult> {
    const binary = this.findCodexBinary();
    if (!binary)
      return {
        success: false,
        reason: 'The codex CLI is no longer on your PATH.',
      };

    // Both halves are removed, and either alone is enough to act on: a user
    // left with a registered marketplace and no plugin still needs it cleared.
    const steps: string[][] = [];
    if (await this.isPluginInstalled())
      steps.push(['plugin', 'remove', PLUGIN_REF]);
    if (this.isMarketplaceRegistered())
      steps.push(['plugin', 'marketplace', 'remove', PLUGIN_MARKETPLACE]);

    if (steps.length === 0) return { success: true, alreadyInstalled: true };

    for (const args of steps) {
      const result = spawnSync(binary, args, { encoding: 'utf-8' });
      if (result.error || result.status !== 0) {
        return reportSpawnFailure('plugin uninstall', describeSpawn(result));
      }
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

    if (await this.isPluginInstalled()) {
      return { success: true, alreadyInstalled: true };
    }

    // `codex plugin marketplace add` exits non-zero once the marketplace is
    // registered, so ask config.toml first. Without this the second run of
    // `mcp add` looked like a failure and reported nothing at all.
    const marketplace = this.isMarketplaceRegistered()
      ? null
      : this.registerMarketplace(binary);
    if (marketplace && !marketplace.success) return marketplace;

    // Registering the catalog does not install from it. Skipping this left the
    // user with a marketplace, no skills, and a wizard reporting success.
    const result = spawnSync(binary, ['plugin', 'add', PLUGIN_REF], {
      encoding: 'utf-8',
    });

    if (result.error || result.status !== 0) {
      return reportSpawnFailure('plugin install', describeSpawn(result));
    }

    return { success: true };
  }

  /**
   * Add the catalog the plugin is published in. A stale cache directory with no
   * config.toml entry reports the marketplace as added from a different source;
   * clear it and retry once.
   */
  private registerMarketplace(binary: string): PluginInstallResult {
    const run = () =>
      spawnSync(
        binary,
        ['plugin', 'marketplace', 'add', PLUGIN_MARKETPLACE_SOURCE],
        { encoding: 'utf-8' },
      );

    let result = run();

    if (
      (result.error || result.status !== 0) &&
      STALE_MARKETPLACE_CACHE.test(describeSpawn(result))
    ) {
      const staleDir = path.join(
        os.homedir(),
        '.codex',
        '.tmp',
        'marketplaces',
        PLUGIN_MARKETPLACE,
      );
      try {
        fs.rmSync(staleDir, { recursive: true, force: true });
      } catch {
        // ignore — retry anyway
      }
      result = run();
    }

    if (result.error || result.status !== 0) {
      const details = describeSpawn(result);
      // Registered by something other than us — the plugin add below can still
      // resolve against it. The stale-cache wording is excluded: that one means
      // the marketplace is NOT usable, and only reaches here if the retry failed.
      if (
        ALREADY_INSTALLED_PATTERN.test(details) &&
        !STALE_MARKETPLACE_CACHE.test(details)
      ) {
        return { success: true };
      }
      return reportSpawnFailure('marketplace add', details);
    }
    return { success: true };
  }
}

export default CodexMCPClient;
