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
  ): Promise<InstallResult> {
    const binary = this.findCodexBinary();
    if (!binary)
      return Promise.resolve({
        success: false,
        reason: 'The codex CLI is no longer on your PATH.',
      });

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
      if (ALREADY_INSTALLED_PATTERN.test(stderr)) {
        return Promise.resolve({ success: true, alreadyInstalled: true });
      }
      const reason = redactSecrets(stderr);
      analytics.captureException(new Error(`Codex MCP add failed: ${reason}`));
      return Promise.resolve({ success: false, reason });
    }
    return Promise.resolve({ success: true });
  }

  /** Codex's own login runs its OAuth and owns the token; the wizard only surfaces the command. */
  loginCommand(local?: boolean): string {
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
