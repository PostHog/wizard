import z from 'zod';
import * as path from 'path';
import * as os from 'os';
import { DefaultMCPClient } from '../MCPClient';
import { getDefaultServerConfig } from '../defaults';

export const ZedMCPConfig = z
  .object({
    context_servers: z.record(
      z.string(),
      z.object({
        enabled: z.boolean().optional(),
        source: z.string().optional(),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string(), z.string()).optional(),
      }),
    ),
  })
  .passthrough();

export type ZedMCPConfig = z.infer<typeof ZedMCPConfig>;

export class ZedClient extends DefaultMCPClient {
  name = 'Zed';

  getServerPropertyName(): string {
    return 'context_servers';
  }

  async isClientSupported(): Promise<boolean> {
    return Promise.resolve(
      process.platform === 'darwin' || process.platform === 'linux',
    );
  }

  async getConfigPath(): Promise<string> {
    const homeDir = os.homedir();
    const isMac = process.platform === 'darwin';
    const isLinux = process.platform === 'linux';

    if (isMac) {
      return Promise.resolve(
        path.join(homeDir, '.config', 'zed', 'settings.json'),
      );
    }

    if (isLinux) {
      // https://zed.dev/docs/configuring-zed#settings-files
      const xdgConfigHome = process.env.XDG_CONFIG_HOME;
      if (xdgConfigHome) {
        return Promise.resolve(
          path.join(xdgConfigHome, 'zed', 'settings.json'),
        );
      }
      return Promise.resolve(
        path.join(homeDir, '.config', 'zed', 'settings.json'),
      );
    }

    throw new Error(`Unsupported platform: ${process.platform}`);
  }

  getServerConfig(
    apiKey: string,
    type: 'sse' | 'streamable-http',
    selectedFeatures?: string[],
  ) {
    const baseConfig = getDefaultServerConfig(apiKey, type, selectedFeatures);
    return {
      enabled: true,
      source: 'custom',
      ...baseConfig,
    };
  }
}
