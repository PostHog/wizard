import { DefaultMCPClient } from '../MCPClient';
import { DefaultMCPClientConfig } from '../defaults';
import { PluginCapable, PluginInstallResult } from '../plugin-client';
import { z } from 'zod';
import { execSync } from 'child_process';
import { analytics } from '../../../utils/analytics';
import { debug, logToFile } from '../../../utils/debug';
import { getUI } from '../../../ui';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

// Stderr signatures that indicate the user's local Claude Code environment is
// the problem, not the wizard. These shouldn't pollute error tracking — we
// surface them to the user and move on.
const USER_ENV_PLUGIN_INSTALL_ERRORS: Array<{
  pattern: RegExp;
  userMessage: string;
}> = [
  {
    pattern: /Invalid JSON syntax in settings file/i,
    userMessage:
      'Your Claude Code settings.json has invalid JSON. Fix the syntax there and re-run the wizard to install the plugin.',
  },
  {
    pattern: /not found in any configured marketplace/i,
    userMessage:
      'The PostHog marketplace is not configured in your Claude Code install, so the plugin could not be installed.',
  },
  {
    pattern:
      /unknown command|unrecognized command|not a claude command|invalid (sub)?command/i,
    userMessage:
      'Your Claude Code CLI is too old to support `plugin install`. Upgrade Claude Code and re-run the wizard to install the plugin.',
  },
];

function classifyPluginInstallError(
  msg: string,
): { userMessage: string } | null {
  for (const { pattern, userMessage } of USER_ENV_PLUGIN_INSTALL_ERRORS) {
    if (pattern.test(msg)) return { userMessage };
  }
  return null;
}

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
    try {
      execSync(`${binary} plugin install posthog`, { stdio: 'pipe' });
      return Promise.resolve({ success: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('already installed') || msg.includes('already exists')) {
        return Promise.resolve({ success: true, alreadyInstalled: true });
      }
      const classified = classifyPluginInstallError(msg);
      if (classified) {
        getUI().log.warn(classified.userMessage);
        logToFile(`[ClaudeCodeMCPClient] plugin install soft-failed: ${msg}`);
        return Promise.resolve({ success: false });
      }
      analytics.captureException(
        new Error(`Claude Code plugin install failed: ${msg}`),
      );
      return Promise.resolve({ success: false });
    }
  }
}
