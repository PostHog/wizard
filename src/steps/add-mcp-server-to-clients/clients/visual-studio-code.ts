import z from 'zod';
import * as path from 'path';
import * as os from 'os';
import { DefaultMCPClient, MCPServerConfig } from '../MCPClient';
import { buildMCPUrl } from '../defaults';
import type { CloudRegion } from '../../../utils/types';

export const VisualStudioCodeMCPConfig = z
  .object({
    servers: z.record(
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

export type VisualStudioCodeMCPConfig = z.infer<
  typeof VisualStudioCodeMCPConfig
>;

export class VisualStudioCodeClient extends DefaultMCPClient {
  name = 'Visual Studio Code';

  getServerPropertyName(): string {
    return 'servers';
  }

  async isClientSupported(): Promise<boolean> {
    return Promise.resolve(
      process.platform === 'darwin' ||
        process.platform === 'win32' ||
        process.platform === 'linux',
    );
  }

  async getConfigPath(): Promise<string> {
    const homeDir = os.homedir();
    const isWindows = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
    const isLinux = process.platform === 'linux';

    if (isMac) {
      return Promise.resolve(
        path.join(
          homeDir,
          'Library',
          'Application Support',
          'Code',
          'User',
          'mcp.json',
        ),
      );
    }

    if (isWindows) {
      return Promise.resolve(
        path.join(process.env.APPDATA || '', 'Code', 'User', 'mcp.json'),
      );
    }

    if (isLinux) {
      return Promise.resolve(
        path.join(homeDir, '.config', 'Code', 'User', 'mcp.json'),
      );
    }

    throw new Error(`Unsupported platform: ${process.platform}`);
  }

  getServerConfig(
    apiKey: string,
    type: 'sse' | 'streamable-http',
    selectedFeatures?: string[],
    local?: boolean,
    region?: CloudRegion,
  ): MCPServerConfig {
    return {
      type: 'http',
      url: buildMCPUrl(type, selectedFeatures, local, region),
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    };
  }

  async addServer(
    apiKey: string,
    selectedFeatures?: string[],
    local?: boolean,
    region?: CloudRegion,
  ): Promise<{ success: boolean }> {
    return this._addServerType(
      apiKey,
      'streamable-http',
      selectedFeatures,
      local,
      region,
    );
  }
}
