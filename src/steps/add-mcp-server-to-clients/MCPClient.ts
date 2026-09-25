import * as fs from 'fs';
import * as path from 'path';
import * as jsonc from 'jsonc-parser';
import { getDefaultServerConfig } from './defaults';
import type { InstallResult } from './results';

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
  ): Promise<InstallResult>;
  abstract removeServer(local?: boolean): Promise<InstallResult>;
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
    } catch {
      return false;
    }
  }

  async addServer(
    apiKey?: string,
    selectedFeatures?: string[],
    local?: boolean,
  ): Promise<InstallResult> {
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

      // An identical entry means this config is already set up — leave the file
      // untouched and report it, so a re-run says "already installed" instead of
      // claiming a write that changed nothing. A differing entry (new features,
      // new key) still gets overwritten and reported as installed.
      const existingServerConfig = typedConfig[serverPropertyName][serverName];
      if (
        existingServerConfig !== undefined &&
        JSON.stringify(existingServerConfig) === JSON.stringify(newServerConfig)
      ) {
        return { success: true, alreadyInstalled: true };
      }

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
    } catch (error) {
      return {
        success: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async removeServer(local?: boolean): Promise<InstallResult> {
    let configPath = '';
    try {
      configPath = await this.getConfigPath();

      if (!fs.existsSync(configPath)) {
        return { success: true, alreadyInstalled: true };
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
      // No PostHog entry to delete — the config changed under us between the
      // detection pass and now. Nothing failed, so don't report a failure.
      return { success: true, alreadyInstalled: true };
    } catch (error) {
      return {
        success: false,
        reason: `${configPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
}
