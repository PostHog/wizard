import { MCPClient } from '../MCPClient';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DefaultMCPClientConfig, getDefaultServerConfig } from '../defaults';
import { z } from 'zod';
import { merge } from 'lodash';

export const ClaudeMCPConfig = DefaultMCPClientConfig;

export type ClaudeMCPConfig = z.infer<typeof DefaultMCPClientConfig>;

export class ClaudeMCPClient extends MCPClient {
  name = 'Claude Desktop';

  constructor() {
    super();
  }

  isClientSupported(): boolean {
    return process.platform === 'darwin' || process.platform === 'win32';
  }

  private getConfigPath(): string {
    const homeDir = os.homedir();
    const isWindows = process.platform === 'win32';
    const isMac = process.platform === 'darwin';

    if (isMac) {
      return path.join(
        homeDir,
        'Library',
        'Application Support',
        'Claude',
        'claude_desktop_config.json',
      );
    }

    if (isWindows) {
      return path.join(
        process.env.APPDATA || '',
        'Claude',
        'claude_desktop_config.json',
      );
    }

    throw new Error(`Unsupported platform: ${process.platform}`);
  }

  async isServerInstalled(): Promise<boolean> {
    try {
      const configPath = this.getConfigPath();

      if (!fs.existsSync(configPath)) {
        return false;
      }

      const configContent = await fs.promises.readFile(configPath, 'utf8');
      const config = ClaudeMCPConfig.parse(JSON.parse(configContent));

      return 'posthog' in config.mcpServers;
    } catch {
      return false;
    }
  }

  async addServer(apiKey: string): Promise<void> {
    const configPath = this.getConfigPath();
    const configDir = path.dirname(configPath);

    await fs.promises.mkdir(configDir, { recursive: true });

    let existingConfig: ClaudeMCPConfig = { mcpServers: {} };

    if (fs.existsSync(configPath)) {
      try {
        const existingContent = await fs.promises.readFile(configPath, 'utf8');
        existingConfig = ClaudeMCPConfig.parse(JSON.parse(existingContent));
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

    try {
      const configContent = await fs.promises.readFile(configPath, 'utf8');
      const config = ClaudeMCPConfig.parse(JSON.parse(configContent));

      if (config.mcpServers && 'posthog' in config.mcpServers) {
        delete config.mcpServers.posthog;

        await fs.promises.writeFile(
          configPath,
          JSON.stringify(config, null, 2),
          'utf8',
        );
      }
    } catch {
      // If we can't read or parse the config, there's nothing to remove
    }
  }
}
