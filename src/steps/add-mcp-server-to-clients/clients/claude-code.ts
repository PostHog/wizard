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

  isServerInstalled(local?: boolean): Promise<boolean> {
    try {
      // check if specific server name exists in output
      const output = execSync('claude mcp list', {
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
    const config = getDefaultServerConfig(
      apiKey,
      'sse',
      selectedFeatures,
      local,
    );
    const serverName = local ? 'posthog-local' : 'posthog';

    const command = `claude mcp add-json ${serverName} -s user '${JSON.stringify(
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

  removeServer(local?: boolean): Promise<{ success: boolean }> {
    const serverName = local ? 'posthog-local' : 'posthog';
    const command = `claude mcp remove --scope user ${serverName}`;

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
