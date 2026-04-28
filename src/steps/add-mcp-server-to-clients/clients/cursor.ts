import { DefaultMCPClient, MCPServerConfig } from '../MCPClient';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { DefaultMCPClientConfig, getNativeHTTPServerConfig } from '../defaults';
import { PluginCapable, PluginInstallResult } from '../plugin-client';
import { analytics } from '../../../utils/analytics';
import { z } from 'zod';

export const CursorMCPConfig = DefaultMCPClientConfig;

export type CursorMCPConfig = z.infer<typeof DefaultMCPClientConfig>;

const CURSOR_EXTENSION_ID = 'posthog.posthog'; // TODO: confirm from Cursor marketplace

export class CursorMCPClient extends DefaultMCPClient implements PluginCapable {
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
    type: 'sse' | 'streamable-http',
    selectedFeatures?: string[],
    local?: boolean,
  ): MCPServerConfig {
    return getNativeHTTPServerConfig(apiKey, type, selectedFeatures, local);
  }

  async addServer(
    apiKey?: string,
    selectedFeatures?: string[],
    local?: boolean,
  ): Promise<{ success: boolean }> {
    return this._addServerType(
      apiKey,
      'streamable-http',
      selectedFeatures,
      local,
    );
  }

  private findCursorBinary(): string | null {
    try {
      execSync('command -v cursor', { stdio: 'pipe' });
      return 'cursor';
    } catch {
      /* not in PATH */
    }
    const macPath =
      '/Applications/Cursor.app/Contents/Resources/app/bin/cursor';
    if (fs.existsSync(macPath)) return macPath;
    return null;
  }

  supportsPlugin(): boolean {
    if (process.platform !== 'darwin' && process.platform !== 'win32')
      return false;
    return this.findCursorBinary() !== null;
  }

  isPluginInstalled(): Promise<boolean> {
    const binary = this.findCursorBinary();
    if (!binary) return Promise.resolve(false);
    try {
      const output = execSync(`${binary} --list-extensions`, {
        stdio: 'pipe',
      }).toString();
      return Promise.resolve(output.toLowerCase().includes('posthog'));
    } catch {
      return Promise.resolve(false);
    }
  }

  installPlugin(): Promise<PluginInstallResult> {
    const binary = this.findCursorBinary();
    if (!binary) return Promise.resolve({ success: false });
    try {
      execSync(`${binary} --install-extension ${CURSOR_EXTENSION_ID}`, {
        stdio: 'pipe',
      });
      return Promise.resolve({ success: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('already installed')) {
        return Promise.resolve({ success: true, alreadyInstalled: true });
      }
      analytics.captureException(
        new Error(`Cursor plugin install failed: ${msg}`),
      );
      return Promise.resolve({ success: false });
    }
  }
}
