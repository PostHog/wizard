import {
  DefaultMCPClient,
  MCPServerConfig,
} from '@shared/mcp-clients/MCPClient';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  DefaultMCPClientConfig,
  getNativeHTTPServerConfig,
} from '@shared/mcp-clients/defaults';
import { z } from 'zod';

export const CursorMCPConfig = DefaultMCPClientConfig;

export type CursorMCPConfig = z.infer<typeof DefaultMCPClientConfig>;

export class CursorMCPClient extends DefaultMCPClient {
  name = 'Cursor';

  constructor() {
    super();
  }

  async isClientSupported(): Promise<boolean> {
    if (process.platform !== 'darwin' && process.platform !== 'win32') {
      return false;
    }
    // Cursor creates ~/.cursor on first launch; without it, it isn't installed.
    return fs.existsSync(path.dirname(await this.getConfigPath()));
  }

  async getConfigPath(): Promise<string> {
    return Promise.resolve(path.join(os.homedir(), '.cursor', 'mcp.json'));
  }

  getServerConfig(
    apiKey: string | undefined,
    selectedFeatures?: string[],
    local?: boolean,
  ): MCPServerConfig {
    return getNativeHTTPServerConfig(apiKey, selectedFeatures, local);
  }
}
