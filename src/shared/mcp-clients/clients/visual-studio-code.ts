import z from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  DefaultMCPClient,
  MCPServerConfig,
} from '@shared/mcp-clients/MCPClient';
import { getNativeHTTPServerConfig } from '@shared/mcp-clients/defaults';
import { runtimeEnv } from '@env';

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
    if (!['darwin', 'win32', 'linux'].includes(process.platform)) return false;
    // VS Code creates its Code/User folder on first launch; without it, it isn't installed.
    return fs.existsSync(path.dirname(await this.getConfigPath()));
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
        path.join(runtimeEnv('APPDATA') || '', 'Code', 'User', 'mcp.json'),
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
    apiKey: string | undefined,
    selectedFeatures?: string[],
    local?: boolean,
  ): MCPServerConfig {
    return {
      type: 'http',
      ...getNativeHTTPServerConfig(apiKey, selectedFeatures, local),
    };
  }
}
