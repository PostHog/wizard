import { DefaultMCPClient } from '../MCPClient';
import * as path from 'path';
import * as os from 'os';
import { DefaultMCPClientConfig } from '../defaults';
import { runtimeEnv } from '@env';
import { z } from 'zod';

export const ClaudeMCPConfig = DefaultMCPClientConfig;

export type ClaudeMCPConfig = z.infer<typeof DefaultMCPClientConfig>;

export class ClaudeMCPClient extends DefaultMCPClient {
  name = 'Claude Desktop';

  constructor() {
    super();
  }

  async isClientSupported(): Promise<boolean> {
    return Promise.resolve(
      process.platform === 'darwin' || process.platform === 'win32',
    );
  }

  async getConfigPath(): Promise<string> {
    const homeDir = os.homedir();
    const isWindows = process.platform === 'win32';
    const isMac = process.platform === 'darwin';

    if (isMac) {
      return Promise.resolve(
        path.join(
          homeDir,
          'Library',
          'Application Support',
          'Claude',
          'claude_desktop_config.json',
        ),
      );
    }

    if (isWindows) {
      return Promise.resolve(
        path.join(
          runtimeEnv('APPDATA') || '',
          'Claude',
          'claude_desktop_config.json',
        ),
      );
    }

    throw new Error(`Unsupported platform: ${process.platform}`);
  }
}
