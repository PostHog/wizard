import { MCPClient } from '../MCPClient';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DefaultMCPClientConfig, getDefaultServerConfig } from '../defaults';
import { z } from 'zod';
import { merge } from 'lodash';

export const CursorMCPConfig = DefaultMCPClientConfig;

export type CursorMCPConfig = z.infer<typeof DefaultMCPClientConfig>;

export class CursorMCPClient extends MCPClient {
  name = 'Cursor';

  constructor() {
    super();
  }

  isClientSupported(): boolean {
    return process.platform === 'darwin' || process.platform === 'win32';
  }

  private getConfigPath(): string {
    return path.join(os.homedir(), '.cursor', 'mcp.json');
  }

  async isServerInstalled(): Promise<boolean> {
    try {
      const configPath = this.getConfigPath();

      if (!fs.existsSync(configPath)) {
        return false;
      }

      const configContent = await fs.promises.readFile(configPath, 'utf8');
      const config = CursorMCPConfig.parse(JSON.parse(configContent));

      return 'posthog' in config.mcpServers;
    } catch {
      return false;
    }
  }

  async addServer(apiKey: string): Promise<void> {
    const configPath = this.getConfigPath();
    const configDir = path.dirname(configPath);

    await fs.promises.mkdir(configDir, { recursive: true });

    let existingConfig: CursorMCPConfig = { mcpServers: {} };

    if (fs.existsSync(configPath)) {
      try {
        const existingContent = await fs.promises.readFile(configPath, 'utf8');
        existingConfig = CursorMCPConfig.parse(JSON.parse(existingContent));
      } catch {
        existingConfig = { mcpServers: {} };
      }
    }

    const newServerConfig = {
      mcpServers: {
        posthog: getDefaultServerConfig(apiKey),
      },
    };

    const mergedConfig = merge({}, existingConfig, newServerConfig);

    await fs.promises.writeFile(
      configPath,
      JSON.stringify(mergedConfig, null, 2),
      'utf8',
    );
  }

  async removeServer(): Promise<void> {
    const configPath = this.getConfigPath();

    if (!fs.existsSync(configPath)) {
      return;
    }

    let config: CursorMCPConfig;

    try {
      const configContent = await fs.promises.readFile(configPath, 'utf8');
      config = CursorMCPConfig.parse(JSON.parse(configContent));
    } catch {
      // If we can't read or parse the config, there's nothing to remove
      return;
    }

    if (config.mcpServers && 'posthog' in config.mcpServers) {
      delete config.mcpServers.posthog;

      await fs.promises.writeFile(
        configPath,
        JSON.stringify(config, null, 2),
        'utf8',
      );
    }
  }
}
