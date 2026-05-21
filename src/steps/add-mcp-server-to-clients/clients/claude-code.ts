import { DefaultMCPClient } from '../MCPClient';
import { DefaultMCPClientConfig } from '../defaults';
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

// Minimum Claude Code CLI version that supports `plugin install`.
export const MIN_PLUGIN_VERSION = '1.0.88';

// Parse a semver-ish string ("1.0.88", "1.0.88 (Claude Code)") into [major, minor, patch].
// Returns null if no version-like token is found.
const parseVersion = (raw: string): [number, number, number] | null => {
  const match = raw.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

const compareVersions = (
  a: [number, number, number],
  b: [number, number, number],
): number => {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
};

export class ClaudeCodeMCPClient
  extends DefaultMCPClient
  implements PluginCapable
{
  name = 'Claude Code';
  private claudeBinaryPath: string | null = null;
  private cliVersion: string | null = null;

  constructor() {
    super();
  }

  // Returns the installed CLI version (cached), or null if it can't be read.
  private getCliVersion(): string | null {
    if (this.cliVersion) return this.cliVersion;
    const binary = this.findClaudeBinary();
    if (!binary) return null;
    try {
      const output = execSync(`${binary} --version`, { stdio: 'pipe' });
      this.cliVersion = output.toString().trim();
      return this.cliVersion;
    } catch {
      return null;
    }
  }

  // True iff the detected CLI version is below MIN_PLUGIN_VERSION.
  // If the version can't be parsed, assume it's recent enough — the actual
  // install will still surface any error.
  private isCliOutdatedForPlugins(): boolean {
    const version = this.getCliVersion();
    if (!version) return false;
    const parsed = parseVersion(version);
    const min = parseVersion(MIN_PLUGIN_VERSION);
    if (!parsed || !min) return false;
    return compareVersions(parsed, min) < 0;
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
      this.cliVersion = version;
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

  isServerInstalled(): Promise<boolean> {
    return this.isPluginInstalled();
  }

  getConfigPath(): Promise<string> {
    throw new Error('Not implemented');
  }

  async addServer(): Promise<{ success: boolean }> {
    const result = await this.installPlugin();
    return { success: result.success };
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
    if (this.isCliOutdatedForPlugins()) {
      debug(
        `  Claude Code CLI ${
          this.cliVersion ?? '(unknown)'
        } is below required ${MIN_PLUGIN_VERSION} for plugin install`,
      );
      return Promise.resolve({ success: false, outdatedClient: true });
    }
    try {
      execSync(`${binary} plugin install posthog`, { stdio: 'pipe' });
      return Promise.resolve({ success: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('already installed') || msg.includes('already exists')) {
        return Promise.resolve({ success: true, alreadyInstalled: true });
      }
      // Fallback: if the CLI itself reports it needs an update, treat as outdated
      // rather than a generic failure. Covers cases where the version pre-check
      // didn't trigger (e.g. unparseable version string).
      if (
        msg.includes('newer version') ||
        msg.includes('needs an update') ||
        msg.includes('is required to continue')
      ) {
        return Promise.resolve({ success: false, outdatedClient: true });
      }
      analytics.captureException(
        new Error(`Claude Code plugin install failed: ${msg}`),
      );
      return Promise.resolve({ success: false });
    }
  }
}
