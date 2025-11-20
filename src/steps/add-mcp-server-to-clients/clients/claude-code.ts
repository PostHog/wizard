import { DefaultMCPClient } from '../MCPClient';
import { DefaultMCPClientConfig } from '../defaults';
import { z } from 'zod';
import { execSync } from 'child_process';
import { analytics } from '../../../utils/analytics';
import { debug } from '../../../utils/debug';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

export const ClaudeCodeMCPConfig = DefaultMCPClientConfig;

export type ClaudeCodeMCPConfig = z.infer<typeof DefaultMCPClientConfig>;

export class ClaudeCodeMCPClient extends DefaultMCPClient {
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
    try {
      const claudeBinary = this.findClaudeBinary();
      if (!claudeBinary) {
        return Promise.resolve(false);
      }

      // check if specific server name exists in output
      const output = execSync(`${claudeBinary} mcp list`, {
        stdio: 'pipe',
      });

      const outputStr = output.toString();
      const serverName = local ? 'posthog-local' : 'posthog';

      if (outputStr.includes(serverName)) {
        return Promise.resolve(true);
      }
    } catch {
      //
    }

    return Promise.resolve(false);
  }

  getConfigPath(): Promise<string> {
    throw new Error('Not implemented');
  }

  addServer(
    apiKey: string,
    selectedFeatures?: string[],
    local?: boolean,
  ): Promise<{ success: boolean }> {
    const claudeBinary = this.findClaudeBinary();
    if (!claudeBinary) {
      return Promise.resolve({ success: false });
    }

    // Build Claude Code-specific config
    // Based on getDefaultServerConfig() but with fixes for Claude Code bugs
    const config = this.buildClaudeCodeConfig(apiKey, selectedFeatures, local);
    const serverName = local ? 'posthog-local' : 'posthog';

    const command = `${claudeBinary} mcp add-json ${serverName} -s user '${JSON.stringify(
      config,
    )}'`;

    try {
      execSync(command);
    } catch (error) {
      analytics.captureException(
        new Error(
          `Failed to add server to Claude Code: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
      return Promise.resolve({ success: false });
    }

    return Promise.resolve({ success: true });
  }

  private buildClaudeCodeConfig(
    apiKey: string,
    selectedFeatures?: string[],
    local?: boolean,
  ) {
    // Replicate getDefaultServerConfig() logic but with Claude Code fixes:
    // 1. Add https:// protocol (mcp-remote requires valid URLs)
    // 2. Embed token directly in Authorization header (env var expansion broken)
    //
    // Claude Code bugs:
    // - https://github.com/anthropics/claude-code/issues/6204
    // - https://github.com/anthropics/claude-code/issues/9427
    // - https://github.com/anthropics/claude-code/issues/10955

    const protocol = local ? 'http://' : 'https://';
    const host = local ? 'localhost:8787' : 'mcp.posthog.com';
    const baseUrl = `${protocol}${host}/sse`;

    const ALL_FEATURE_VALUES = [
      'dashboards',
      'insights',
      'experiments',
      'llm-analytics',
      'error-tracking',
      'flags',
      'workspace',
      'docs',
    ];

    const isAllFeaturesSelected =
      selectedFeatures &&
      selectedFeatures.length === ALL_FEATURE_VALUES.length &&
      ALL_FEATURE_VALUES.every((feature) => selectedFeatures.includes(feature));

    const urlWithFeatures =
      selectedFeatures && selectedFeatures.length > 0 && !isAllFeaturesSelected
        ? `${baseUrl}?features=${selectedFeatures.join(',')}`
        : baseUrl;

    return {
      command: 'npx',
      args: [
        '-y',
        'mcp-remote@latest',
        urlWithFeatures,
        '--header',
        `Authorization:Bearer ${apiKey}`, // Embed token directly (not ${VAR})
      ],
      // Keep env block for backward compatibility if bugs get fixed
      env: {
        POSTHOG_AUTH_HEADER: `Bearer ${apiKey}`,
      },
    };
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
}
