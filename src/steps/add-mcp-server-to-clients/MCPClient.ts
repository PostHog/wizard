import * as fs from 'fs';
import * as path from 'path';
import * as jsonc from 'jsonc-parser';
import { getDefaultServerConfig } from './defaults';
import { analytics } from '@utils/analytics';

export type MCPServerConfig = Record<string, unknown>;

export abstract class MCPClient {
  name: string;
  abstract getConfigPath(): Promise<string>;
  abstract getServerPropertyName(): string;
  abstract isServerInstalled(local?: boolean): Promise<boolean>;
  abstract addServer(
    apiKey?: string,
    selectedFeatures?: string[],
    local?: boolean,
  ): Promise<{ success: boolean }>;
  abstract removeServer(local?: boolean): Promise<{ success: boolean }>;
  abstract isClientSupported(): Promise<boolean>;
}

export abstract class DefaultMCPClient extends MCPClient {
  name = 'Default';

  constructor() {
    super();
  }

  getServerPropertyName(): string {
    return 'mcpServers';
  }

  getServerConfig(
    apiKey: string | undefined,
    selectedFeatures?: string[],
    local?: boolean,
  ): MCPServerConfig {
    return getDefaultServerConfig(apiKey, selectedFeatures, local);
  }

  async isServerInstalled(local?: boolean): Promise<boolean> {
    try {
      const configPath = await this.getConfigPath();

      if (!fs.existsSync(configPath)) {
        return false;
      }

      const configContent = await fs.promises.readFile(configPath, 'utf8');
      const config = jsonc.parse(configContent) as Record<string, any>;
      const serverPropertyName = this.getServerPropertyName();
      const serverName = local ? 'posthog-local' : 'posthog';

      return (
        serverPropertyName in config && serverName in config[serverPropertyName]
      );
    } catch (err) {
      analytics.captureException(
        err instanceof Error ? err : new Error(String(err)),
        { step: 'is_server_installed' },
      );
      return false;
    }
  }

  async addServer(
    apiKey?: string,
    selectedFeatures?: string[],
    local?: boolean,
  ): Promise<{ success: boolean }> {
    try {
      const configPath = await this.getConfigPath();
      const configDir = path.dirname(configPath);

      await fs.promises.mkdir(configDir, { recursive: true });

      const serverPropertyName = this.getServerPropertyName();
      let configContent = '';
      let existingConfig = {};

      if (fs.existsSync(configPath)) {
        configContent = await fs.promises.readFile(configPath, 'utf8');
        existingConfig = jsonc.parse(configContent) || {};
      }

      const newServerConfig = this.getServerConfig(
        apiKey,
        selectedFeatures,
        local,
      );
      const typedConfig = existingConfig as Record<string, any>;
      if (!typedConfig[serverPropertyName]) {
        typedConfig[serverPropertyName] = {};
      }
      const serverName = local ? 'posthog-local' : 'posthog';
      typedConfig[serverPropertyName][serverName] = newServerConfig;

      const edits = jsonc.modify(
        configContent,
        [serverPropertyName, serverName],
        newServerConfig,
        {
          formattingOptions: {
            tabSize: 2,
            insertSpaces: true,
          },
        },
      );

      const modifiedContent = jsonc.applyEdits(configContent, edits);

      await fs.promises.writeFile(configPath, modifiedContent, 'utf8');

      return { success: true };
    } catch (err) {
      analytics.captureException(
        err instanceof Error ? err : new Error(String(err)),
        { step: 'add_server' },
      );
      return { success: false };
    }
  }

  async removeServer(local?: boolean): Promise<{ success: boolean }> {
    try {
      const configPath = await this.getConfigPath();

      if (!fs.existsSync(configPath)) {
        return { success: false };
      }

      const configContent = await fs.promises.readFile(configPath, 'utf8');
      const config = jsonc.parse(configContent) as Record<string, any>;
      const serverPropertyName = this.getServerPropertyName();

      const serverName = local ? 'posthog-local' : 'posthog';

      if (
        serverPropertyName in config &&
        serverName in config[serverPropertyName]
      ) {
        const edits = jsonc.modify(
          configContent,
          [serverPropertyName, serverName],
          undefined,
          {
            formattingOptions: {
              tabSize: 2,
              insertSpaces: true,
            },
          },
        );

        const modifiedContent = jsonc.applyEdits(configContent, edits);

        await fs.promises.writeFile(configPath, modifiedContent, 'utf8');

        return { success: true };
      }
    } catch (err) {
      analytics.captureException(
        err instanceof Error ? err : new Error(String(err)),
        { step: 'remove_server' },
      );
      //
    }

    return { success: false };
  }
}
