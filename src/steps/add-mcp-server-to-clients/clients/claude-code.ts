import { DefaultMCPClient } from '../MCPClient';
import { DefaultMCPClientConfig, buildMCPUrl } from '../defaults';
import { PluginCapable, PluginInstallResult } from '../plugin-client';
import { z } from 'zod';
import { execSync } from 'child_process';
import { analytics } from '../../../utils/analytics';
import { debug } from '../../../utils/debug';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

export const ClaudeCodeMCPConfig = DefaultMCPClientConfig;

export type ClaudeCodeMCPConfig = z.infer<typeof DefaultMCPClientConfig>;

export class ClaudeCodeMCPClient
  extends DefaultMCPClient
  implements PluginCapable
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
    try {
      const output = execSync(`${binary} mcp list`, { stdio: 'pipe' })
        .toString()
        .toLowerCase();
      return Promise.resolve(output.includes(serverName));
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
  ): Promise<{ success: boolean }> {
    const binary = this.findClaudeBinary();
    if (!binary) return Promise.resolve({ success: false });

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
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('already exists')) {
        return Promise.resolve({ success: true });
      }
      analytics.captureException(
        new Error(`Claude Code MCP add failed: ${msg}`),
      );
      return Promise.resolve({ success: false });
    }
  }

  removeServer(local?: boolean): Promise<{ success: boolean }> {
    const claudeBinary = this.findClaudeBinary();
    if (!claudeBinary) {
      return Promise.resolve({ success: false });
    }

    const serverName = local ? 'posthog-local' : 'posthog';
    const command = `${claudeBinary} mcp remove --scope user ${serverName}`;

    try {
      execSync(command);
    } catch (error) {
      analytics.captureException(
        new Error(
          `Failed to remove server from Claude Code: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
      return Promise.resolve({ success: false });
    }

    return Promise.resolve({ success: true });
  }

  supportsPlugin(): boolean {
    return this.findClaudeBinary() !== null;
  }

  isPluginInstalled(): Promise<boolean> {
    const binary = this.findClaudeBinary();
    if (!binary) return Promise.resolve(false);
    try {
      const output = execSync(`${binary} plugin list`, {
        stdio: 'pipe',
      }).toString();
      return Promise.resolve(output.toLowerCase().includes('posthog'));
    } catch {
      return Promise.resolve(false);
    }
  }

  installPlugin(): Promise<PluginInstallResult> {
    const binary = this.findClaudeBinary();
    if (!binary) return Promise.resolve({ success: false });
    try {
      execSync(`${binary} plugin install posthog`, { stdio: 'pipe' });
      return Promise.resolve({ success: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('already installed') || msg.includes('already exists')) {
        return Promise.resolve({ success: true, alreadyInstalled: true });
      }
      analytics.captureException(
        new Error(`Claude Code plugin install failed: ${msg}`),
      );
      return Promise.resolve({ success: false });
    }
  }
}
