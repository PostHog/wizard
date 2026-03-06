import { execSync } from 'node:child_process';
import z from 'zod';
import * as path from 'path';
import * as os from 'os';
import { DefaultMCPClient, MCPServerConfig } from '../MCPClient';
import { buildMCPUrl } from '../defaults';

export const CopilotCLIMCPConfig = z
  .object({
    mcpServers: z.record(
      z.string(),
      z.union([
        z.object({
          command: z.string().optional(),
          args: z.array(z.string()).optional(),
          env: z.record(z.string(), z.string()).optional(),
        }),
        z.object({
          type: z.enum(['http', 'sse']),
          url: z.string(),
          headers: z.record(z.string(), z.string()).optional(),
        }),
      ]),
    ),
  })
  .passthrough();

export type CopilotCLIMCPConfig = z.infer<typeof CopilotCLIMCPConfig>;

export class CopilotCLIMCPClient extends DefaultMCPClient {
  name = 'Copilot CLI';

  async isClientSupported(): Promise<boolean> {
    try {
      execSync('copilot --version', { stdio: 'ignore' });
      return Promise.resolve(true);
    } catch {
      return Promise.resolve(false);
    }
  }

  async getConfigPath(): Promise<string> {
    const homeDir = os.homedir();

    if (process.platform === 'win32') {
      return Promise.resolve(
        path.join(
          process.env.USERPROFILE || homeDir,
          '.copilot',
          'mcp-config.json',
        ),
      );
    }

    return Promise.resolve(path.join(homeDir, '.copilot', 'mcp-config.json'));
  }

  getServerConfig(
    apiKey: string | undefined,
    type: 'sse' | 'streamable-http',
    selectedFeatures?: string[],
    local?: boolean,
  ): MCPServerConfig {
    const url = buildMCPUrl(type, selectedFeatures, local);

    if (apiKey) {
      return {
        type: 'http',
        url,
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      };
    }

    return {
      type: 'http',
      url,
    };
  }

  async addServer(
    apiKey?: string,
    selectedFeatures?: string[],
    local?: boolean,
  ): Promise<{ success: boolean }> {
    return this._addServerType(
      apiKey,
      'streamable-http',
      selectedFeatures,
      local,
    );
  }
}
