import { z } from 'zod';
import type { SpawnSyncReturns } from 'node:child_process';
import { execSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { DefaultMCPClient } from '@steps/add-mcp-server-to-clients/MCPClient';
import {
  DefaultMCPClientConfig,
  buildMCPUrl,
} from '@steps/add-mcp-server-to-clients/defaults';
import {
  PluginCapable,
  PluginInstallResult,
} from '@steps/add-mcp-server-to-clients/plugin-client';

import { analytics } from '@utils/analytics';

export const CodexMCPConfig = DefaultMCPClientConfig;

export type CodexMCPConfig = z.infer<typeof DefaultMCPClientConfig>;

/**
 * Codex resolves its state directory from CODEX_HOME, falling back to
 * ~/.codex. Anything that reads config.toml or the marketplace cache has to
 * honour the same override, or it silently operates on the wrong directory.
 */
function codexHome(): string {
  return process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex');
}

/**
 * `spawnSync` signals failure three different ways — a spawn-level `error`
 * (ENOENT/EACCES), a non-zero `status`, or a terminating `signal` — and Codex
 * sometimes writes the reason to stdout rather than stderr. Reading only
 * stderr turns every one of those into an empty message, so fold them all in.
 */
function describeSpawnFailure(result: SpawnSyncReturns<string>): string {
  const parts: string[] = [];
  if (result.error) parts.push(`spawn error: ${result.error.message}`);
  if (result.signal) parts.push(`killed by ${result.signal}`);
  else if (typeof result.status === 'number')
    parts.push(`exit ${result.status}`);

  const stderr = (result.stderr ?? '').trim();
  const stdout = (result.stdout ?? '').trim();
  if (stderr) parts.push(`stderr: ${stderr}`);
  if (stdout) parts.push(`stdout: ${stdout}`);

  // Never hand back an empty string — a blank tail is exactly what made this
  // failure untriageable in the first place.
  return parts.length > 0 ? parts.join(' | ') : 'no output, status unavailable';
}

/**
 * A Codex CLI predating `plugin marketplace` rejects the subcommand outright.
 * That is a user-environment limitation, not a wizard bug.
 */
function isUnsupportedSubcommand(output: string): boolean {
  const lower = output.toLowerCase();
  return (
    lower.includes("unexpected argument 'marketplace'") ||
    lower.includes("unexpected argument 'plugin'") ||
    lower.includes('unrecognized subcommand')
  );
}

/** Transient network trouble while Codex clones the marketplace repo. */
function isTransientNetworkFailure(output: string): boolean {
  const lower = output.toLowerCase();
  return (
    lower.includes('unable to access') ||
    lower.includes('could not resolve host') ||
    lower.includes('connection reset') ||
    lower.includes('connection timed out') ||
    lower.includes('ssl_connect') ||
    lower.includes('ssl routines')
  );
}

export class CodexMCPClient extends DefaultMCPClient implements PluginCapable {
  name = 'Codex';
  private codexBinaryPath: string | null = null;
  private pluginSupported: boolean | null = null;

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

  isClientSupported(): Promise<boolean> {
    return Promise.resolve(this.findCodexBinary() !== null);
  }

  getConfigPath(): Promise<string> {
    throw new Error('Not implemented');
  }

  isServerInstalled(local?: boolean): Promise<boolean> {
    const binary = this.findCodexBinary();
    if (!binary) return Promise.resolve(false);
    const serverName = local ? 'posthog-local' : 'posthog';
    const result = spawnSync(binary, ['mcp', 'list'], { encoding: 'utf-8' });
    if (result.status !== 0) return Promise.resolve(false);
    return Promise.resolve(
      (result.stdout ?? '').toLowerCase().includes(serverName),
    );
  }

  addServer(
    apiKey?: string,
    selectedFeatures?: string[],
    local?: boolean,
  ): Promise<{ success: boolean }> {
    const binary = this.findCodexBinary();
    if (!binary) return Promise.resolve({ success: false });

    const serverName = local ? 'posthog-local' : 'posthog';
    const url = buildMCPUrl(selectedFeatures, local);
    const args = ['mcp', 'add', serverName, '--url', url];
    const env = { ...process.env };
    if (apiKey) {
      const tokenVar = 'POSTHOG_AUTH_HEADER';
      env[tokenVar] = `Bearer ${apiKey}`;
      args.push('--bearer-token-env-var', tokenVar);
    }

    const result = spawnSync(binary, args, { encoding: 'utf-8', env });
    if (result.status !== 0) {
      const stderr = result.stderr ?? '';
      if (stderr.toLowerCase().includes('already')) {
        return Promise.resolve({ success: true });
      }
      analytics.captureException(new Error(`Codex MCP add failed: ${stderr}`));
      return Promise.resolve({ success: false });
    }
    return Promise.resolve({ success: true });
  }

  removeServer(): Promise<{ success: boolean }> {
    const binary = this.findCodexBinary();
    if (!binary) return Promise.resolve({ success: false });

    const result = spawnSync(binary, ['mcp', 'remove', 'posthog'], {
      stdio: 'ignore',
    });

    if (result.error || result.status !== 0) {
      analytics.captureException(
        new Error('Failed to remove server from Codex CLI.'),
      );
      return Promise.resolve({ success: false });
    }

    return Promise.resolve({ success: true });
  }

  supportsPlugin(): boolean {
    if (this.pluginSupported !== null) return this.pluginSupported;

    const binary = this.findCodexBinary();
    if (!binary) return (this.pluginSupported = false);

    // Probing `codex plugin --help` is no good: clap short-circuits on --help
    // and an older CLI happily prints top-level help with exit 0. The command
    // list from `codex --help` is the reliable signal — older CLIs have no
    // `plugin` entry at all.
    const help = spawnSync(binary, ['--help'], { encoding: 'utf-8' });
    if (help.error || help.status !== 0) return (this.pluginSupported = false);

    return (this.pluginSupported = /^\s+plugin\s+/m.test(help.stdout ?? ''));
  }

  isPluginInstalled(): Promise<boolean> {
    const configPath = path.join(codexHome(), 'config.toml');
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

  installPlugin(): Promise<PluginInstallResult> {
    const binary = this.findCodexBinary();
    if (!binary) return Promise.resolve({ success: false });

    const run = () =>
      spawnSync(binary, ['plugin', 'marketplace', 'add', 'PostHog/ai-plugin'], {
        encoding: 'utf-8',
      });

    let result = run();

    // Stale cache directory with no config.toml entry — clear it and retry
    if (
      result.status !== 0 &&
      (result.stderr ?? '').includes('already added from a different source')
    ) {
      const staleDir = path.join(
        codexHome(),
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

    if (result.status === 0) return Promise.resolve({ success: true });

    const details = describeSpawnFailure(result);

    // Not our bug and not actionable: an out-of-date Codex CLI, a user
    // interrupt (Ctrl-C during the marketplace clone), or a flaky network.
    const notActionable =
      isUnsupportedSubcommand(details) ||
      isTransientNetworkFailure(details) ||
      result.signal === 'SIGINT' ||
      result.signal === 'SIGTERM';

    if (!notActionable) {
      analytics.captureException(
        new Error(`Codex plugin install failed: ${details}`),
      );
    }

    return Promise.resolve({ success: false });
  }
}

export default CodexMCPClient;
