import { DefaultMCPClient } from '@steps/add-mcp-server-to-clients/MCPClient';
import {
  DefaultMCPClientConfig,
  getNativeHTTPServerConfig,
} from '@steps/add-mcp-server-to-clients/defaults';
import { z } from 'zod';
import { spawnSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { debug } from '@utils/debug';

export const OpenCodeMCPConfig = DefaultMCPClientConfig;

export type OpenCodeMCPConfig = z.infer<typeof DefaultMCPClientConfig>;

export class OpenCodeMCPClient extends DefaultMCPClient {
  name = 'OpenCode';

  isClientSupported(): Promise<boolean> {
    try {
      debug('  Checking for OpenCode...');
      const result = spawnSync('opencode', ['--version'], { stdio: 'pipe' });
      if (result.status === 0) {
        const version = result.stdout.toString().trim();
        debug(`  OpenCode detected: ${version}`);
        return Promise.resolve(true);
      }
      debug('  OpenCode not found');
      return Promise.resolve(false);
    } catch {
      debug('  OpenCode not found');
      return Promise.resolve(false);
    }
  }

  getConfigPath(): Promise<string> {
    return Promise.resolve(
      path.join(os.homedir(), '.config', 'opencode', 'opencode.json'),
    );
  }

  async isServerInstalled(local?: boolean): Promise<boolean> {
    try {
      const configPath = await this.getConfigPath();
      if (!fs.existsSync(configPath)) return false;

      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const serverName = local ? 'posthog-local' : 'posthog';

      return config.mcp?.[serverName] !== undefined;
    } catch {
      return false;
    }
  }

  addServer(
    apiKey?: string,
    selectedFeatures?: string[],
    local?: boolean,
  ): Promise<{ success: boolean }> {
    try {
      const serverName = local ? 'posthog-local' : 'posthog';
      const url = this.getURL(selectedFeatures, local);

      const args = ['mcp', 'add', serverName, '--url', url];

      if (apiKey) {
        args.push('--header', `Authorization=Bearer ${apiKey}`);
      }

      const result = spawnSync('opencode', args, { stdio: 'pipe' });

      if (result.status === 0) {
        return Promise.resolve({ success: true });
      }

      debug(`  OpenCode mcp add failed: ${result.stderr.toString()}`);
      return Promise.resolve({ success: false });
    } catch (error) {
      debug(`  OpenCode mcp add error: ${error}`);
      return Promise.resolve({ success: false });
    }
  }

  async removeServer(local?: boolean): Promise<{ success: boolean }> {
    try {
      const configPath = await this.getConfigPath();
      if (!fs.existsSync(configPath)) return { success: false };

      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const serverName = local ? 'posthog-local' : 'posthog';

      if (config.mcp?.[serverName]) {
        delete config.mcp[serverName];
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
        return { success: true };
      }

      return { success: false };
    } catch {
      return { success: false };
    }
  }

  private getURL(selectedFeatures?: string[], local?: boolean): string {
    return getNativeHTTPServerConfig(undefined, selectedFeatures, local)
      .url as string;
  }
}
