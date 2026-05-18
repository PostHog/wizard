import { z } from 'zod';
import { execSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { DefaultMCPClient } from '../MCPClient';
import { DefaultMCPClientConfig } from '../defaults';
import {
  PluginCapable,
  PluginInstallResult,
  isExternalClientConfigError,
} from '../plugin-client';

import { analytics } from '../../../utils/analytics';
import { debug } from '../../../utils/debug';

export const CodexMCPConfig = DefaultMCPClientConfig;

export type CodexMCPConfig = z.infer<typeof DefaultMCPClientConfig>;

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

  isServerInstalled(): Promise<boolean> {
    return this.isPluginInstalled();
  }

  async addServer(): Promise<{ success: boolean }> {
    const result = await this.installPlugin();
    return { success: result.success };
  }

  removeServer(): Promise<{ success: boolean }> {
    const binary = this.findCodexBinary();
    if (!binary) return Promise.resolve({ success: false });

    const result = spawnSync(binary, ['mcp', 'remove', 'posthog'], {
      encoding: 'utf-8',
    });

    if (result.error || result.status !== 0) {
      const stderr = result.stderr ?? '';
      if (isExternalClientConfigError(stderr)) {
        debug(
          `Codex mcp remove skipped: existing Codex config is malformed. ${stderr.trim()}`,
        );
        return Promise.resolve({ success: false });
      }
      analytics.captureException(
        new Error(`Failed to remove server from Codex CLI: ${stderr}`),
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
      const stderr = result.stderr ?? '';
      if (isExternalClientConfigError(stderr)) {
        debug(
          `Codex plugin install skipped: existing Codex config is malformed. ${stderr.trim()}`,
        );
        return Promise.resolve({ success: false });
      }
      analytics.captureException(
        new Error(`Codex plugin install failed: ${stderr}`),
      );
      return Promise.resolve({ success: false });
    }

    return Promise.resolve({ success: true });
  }
}

export default CodexMCPClient;
