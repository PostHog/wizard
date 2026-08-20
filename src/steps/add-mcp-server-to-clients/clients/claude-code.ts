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
import { z } from 'zod';
import { execSync } from 'child_process';
import { analytics } from '@utils/analytics';
import { debug } from '@utils/debug';
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
    // `mcp get <name>` exits non-zero when the entry doesn't exist. A substring
    // scan of `mcp list` reports anyone's posthog-ish server — the claude.ai
    // "PostHog" connector and the plugin's `plugin:posthog:posthog` both match,
    // making install/remove look like no-ops forever.
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
    const addCommand = this.buildAddCommand(binary, serverName, url);

    try {
      execSync(addCommand, { stdio: 'pipe' });
      return Promise.resolve({ success: true });
    } catch (error) {
      // Redact before this reaches a log, the screen, or an exception report —
      // the failing command echoes its arguments back in the error output.
      const msg = redactSecrets(
        error instanceof Error ? error.message : String(error),
      );
      if (msg.includes('already exists')) {
        // The URL encodes the feature selection, so an existing entry with a
        // different URL must be replaced — leaving it "as is" means the user's
        // new selection silently never takes effect, and their next OAuth in
        // Claude Code authorizes the wrong toolset. An entry that already
        // points at this exact URL is left untouched: removing it would throw
        // away the OAuth credentials Claude Code holds for it and force a
        // needless re-auth.
        const previousUrl = this.installedServerUrl(binary, serverName);
        if (previousUrl === url) {
          return Promise.resolve({ success: true, alreadyInstalled: true });
        }
        return Promise.resolve(
          this.replaceServer(binary, serverName, addCommand, previousUrl),
        );
      }
      analytics.captureException(
        new Error(`Claude Code MCP add failed: ${msg}`),
      );
      return Promise.resolve({ success: false, reason: msg });
    }
  }

  /** URL the existing entry points at, or null when it can't be determined. */
  private installedServerUrl(
    binary: string,
    serverName: string,
  ): string | null {
    try {
      const output = execSync(`${binary} mcp get ${serverName}`, {
        stdio: 'pipe',
      }).toString();
      const match = output.match(/URL:\s*(\S+)/i);
      return match ? match[1]! : null;
    } catch {
      return null;
    }
  }

  private buildAddCommand(
    binary: string,
    serverName: string,
    url: string,
  ): string {
    return [
      binary,
      'mcp',
      'add',
      '--transport',
      'http',
      '--scope',
      'user',
      serverName,
      url,
    ]
      .map((a) => JSON.stringify(a))
      .join(' ');
  }

  private replaceServer(
    binary: string,
    serverName: string,
    addCommand: string,
    previousUrl: string | null,
  ): InstallResult {
    let removed = false;
    try {
      execSync(`${binary} mcp remove --scope user ${serverName}`, {
        stdio: 'pipe',
      });
      removed = true;
      execSync(addCommand, { stdio: 'pipe' });
      return { success: true };
    } catch (error) {
      const msg = redactSecrets(
        error instanceof Error ? error.message : String(error),
      );
      // Re-add fails after a successful remove: put the previous entry back so a
      // failed update never leaves the user with no server at all.
      if (removed && previousUrl) {
        try {
          execSync(this.buildAddCommand(binary, serverName, previousUrl), {
            stdio: 'pipe',
          });
        } catch {
          // The failure report below already tells the user to re-run.
        }
      }
      analytics.captureException(
        new Error(`Claude Code MCP update failed: ${msg}`),
      );
      return { success: false, reason: msg };
    }
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

    try {
      execSync(`${binary} plugin install posthog`, { stdio: 'pipe' });
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('already installed') || msg.includes('already exists')) {
        return { success: true, alreadyInstalled: true };
      }
      analytics.captureException(
        new Error(`Claude Code plugin install failed: ${msg}`),
      );
      return { success: false, reason: msg };
    }
  }
}
