import z from 'zod';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { execSync } from 'node:child_process';
import {
  DefaultMCPClient,
  MCPServerConfig,
} from '@steps/add-mcp-server-to-clients/MCPClient';
import { getNativeHTTPServerConfig } from '@steps/add-mcp-server-to-clients/defaults';
import { runtimeEnv } from '@env';

export const OpenCodeMCPConfig = z
  .object({
    mcp: z.record(
      z.string(),
      z.object({
        type: z.literal('remote'),
        url: z.string(),
        headers: z.record(z.string(), z.string()).optional(),
      }),
    ),
  })
  .passthrough();

export type OpenCodeMCPConfig = z.infer<typeof OpenCodeMCPConfig>;

export class OpenCodeMCPClient extends DefaultMCPClient {
  name = 'OpenCode';
  private opencodeBinaryPath: string | null = null;

  override getServerPropertyName(): string {
    return 'mcp';
  }

  private findOpenCodeBinary(): string | null {
    if (this.opencodeBinaryPath) return this.opencodeBinaryPath;
    try {
      const resolved = execSync('command -v opencode', { stdio: 'pipe' })
        .toString()
        .trim();
      if (resolved) {
        this.opencodeBinaryPath = resolved;
        return resolved;
      }
    } catch {
      // not in PATH
    }
    return null;
  }

  isClientSupported(): Promise<boolean> {
    return Promise.resolve(this.findOpenCodeBinary() !== null);
  }

  getConfigPath(): Promise<string> {
    const configDir = this.resolveConfigDir();
    const jsoncPath = path.join(configDir, 'opencode.jsonc');
    const jsonPath = path.join(configDir, 'opencode.json');
    if (fs.existsSync(jsoncPath)) return Promise.resolve(jsoncPath);
    return Promise.resolve(jsonPath);
  }

  private resolveConfigDir(): string {
    const envDir = runtimeEnv('OPENCODE_CONFIG_DIR');
    if (envDir) return envDir;

    const xdgHome = runtimeEnv('XDG_CONFIG_HOME');
    if (xdgHome) return path.join(xdgHome, 'opencode');

    return path.join(os.homedir(), '.config', 'opencode');
  }

  override getServerConfig(
    apiKey: string | undefined,
    selectedFeatures?: string[],
    local?: boolean,
  ): MCPServerConfig {
    return {
      type: 'remote',
      ...getNativeHTTPServerConfig(apiKey, selectedFeatures, local),
    };
  }
}
