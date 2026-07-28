import { z } from 'zod';
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
import { logToFile } from '@utils/debug';

export const CodexMCPConfig = DefaultMCPClientConfig;

export type CodexMCPConfig = z.infer<typeof DefaultMCPClientConfig>;

/**
 * Hard ceiling on any `codex` subprocess. `codex mcp add` for a remote server
 * can otherwise block for a long time on Codex's own OAuth handshake (see
 * `addServer`), so every spawnSync here is bounded to fail fast instead of
 * hanging the wizard.
 */
const CODEX_COMMAND_TIMEOUT_MS = 20_000;

const TOKEN_ENV_VAR = 'POSTHOG_AUTH_HEADER';

export class CodexMCPClient extends DefaultMCPClient implements PluginCapable {
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
    const result = spawnSync(binary, ['mcp', 'list'], {
      encoding: 'utf-8',
      timeout: CODEX_COMMAND_TIMEOUT_MS,
    });
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

    // Without a bearer token, `codex mcp add --url` falls into Codex's own
    // interactive OAuth flow against the remote server. In a non-interactive
    // wizard run that browser handshake can never complete, so Codex blocks
    // until its OAuth deadline elapses and then errors. Skip that path
    // entirely rather than hanging — the server can be added later once a
    // personal API key is available.
    if (!apiKey) {
      logToFile(
        `[Codex] Skipping MCP install for "${serverName}": no PostHog API key, ` +
          `and adding without one triggers an interactive OAuth flow. ` +
          `Add it later with: codex mcp add ${serverName} --url ${url} ` +
          `--bearer-token-env-var ${TOKEN_ENV_VAR}`,
      );
      return Promise.resolve({ success: false });
    }

    const args = [
      'mcp',
      'add',
      serverName,
      '--url',
      url,
      '--bearer-token-env-var',
      TOKEN_ENV_VAR,
    ];
    const env = { ...process.env, [TOKEN_ENV_VAR]: `Bearer ${apiKey}` };

    const result = spawnSync(binary, args, {
      encoding: 'utf-8',
      env,
      timeout: CODEX_COMMAND_TIMEOUT_MS,
    });

    // A timeout (or any spawn failure) surfaces on `result.error`, with
    // `status` left null. Degrade gracefully with a diagnostic instead of
    // firing a captured exception — the process was bounded on purpose.
    if (result.error) {
      const timedOut =
        (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
      logToFile(
        `[Codex] MCP install for "${serverName}" ${
          timedOut
            ? `timed out after ${CODEX_COMMAND_TIMEOUT_MS}ms`
            : `failed to run: ${result.error.message}`
        }. Skipping.`,
      );
      return Promise.resolve({ success: false });
    }

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
      timeout: CODEX_COMMAND_TIMEOUT_MS,
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
      analytics.captureException(
        new Error(`Codex plugin install failed: ${result.stderr ?? ''}`),
      );
      return Promise.resolve({ success: false });
    }

    return Promise.resolve({ success: true });
  }
}

export default CodexMCPClient;
