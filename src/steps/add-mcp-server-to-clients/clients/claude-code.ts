import { DefaultMCPClient } from '../MCPClient';
import { DefaultMCPClientConfig, getDefaultServerConfig } from '../defaults';
import { z } from 'zod';
import { execSync } from 'child_process';
import { analytics } from '../../../utils/analytics';

export const ClaudeCodeMCPConfig = DefaultMCPClientConfig;

export type ClaudeCodeMCPConfig = z.infer<typeof DefaultMCPClientConfig>;

export class ClaudeCodeMCPClient extends DefaultMCPClient {
  name = 'Claude Code';

  constructor() {
    super();
  }

  isClientSupported(): Promise<boolean> {
    try {
      execSync('claude --version', { stdio: 'ignore' });
      return Promise.resolve(true);
    } catch {
      return Promise.resolve(false);
    }
  }

  isServerInstalled(): Promise<boolean> {
    try {
      // check if posthog in output
      const output = execSync('claude mcp list', {
        stdio: 'pipe',
      });

      if (output.toString().includes('posthog')) {
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

  addServer(apiKey: string): Promise<{ success: boolean }> {
    const config = getDefaultServerConfig(apiKey, 'sse');

    const command = `claude mcp add-json posthog -s user '${JSON.stringify(
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

  removeServer(): Promise<{ success: boolean }> {
    const command = `claude mcp remove --scope user posthog`;

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
