import {
  DefaultMCPClient,
  MCPServerConfig,
} from '@steps/add-mcp-server-to-clients/MCPClient';
import * as path from 'path';
import * as os from 'os';
import {
  DefaultMCPClientConfig,
  getNativeHTTPServerConfig,
} from '@steps/add-mcp-server-to-clients/defaults';
import { z } from 'zod';

export const CursorMCPConfig = DefaultMCPClientConfig;

export type CursorMCPConfig = z.infer<typeof DefaultMCPClientConfig>;

export class CursorMCPClient extends DefaultMCPClient {
  name = 'Cursor';

  constructor() {
    super();
  }

  async isClientSupported(): Promise<boolean> {
    return Promise.resolve(
      process.platform === 'darwin' || process.platform === 'win32',
    );
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
