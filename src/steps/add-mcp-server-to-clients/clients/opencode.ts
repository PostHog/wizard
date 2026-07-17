import z from 'zod';
import * as path from 'path';
import * as os from 'os';
import {
  DefaultMCPClient,
  MCPServerConfig,
} from '@steps/add-mcp-server-to-clients/MCPClient';
import { getNativeHTTPServerConfig } from '@steps/add-mcp-server-to-clients/defaults';
import { runtimeEnv } from '@env';

/**
 * OpenCode MCP config schema (subset).
 *
 * Source: https://opencode.ai/docs/mcp-servers — OpenCode discriminates
 * server entries by a required `type` field (`"local"` or `"remote"`) and
 * groups them under a top-level `"mcp"` object (not `"mcpServers"`). Local
 * servers take `command` as an *array* and use `environment` (not `env`);
 * remote servers take `url` plus optional `headers` / `oauth`.
 */
export const OpenCodeMCPConfig = z
  .object({
    mcp: z.record(
      z.string(),
      z.union([
        z.object({
          type: z.literal('local'),
          command: z.array(z.string()),
          environment: z.record(z.string(), z.string()).optional(),
          enabled: z.boolean().optional(),
          cwd: z.string().optional(),
          timeout: z.number().optional(),
        }),
        z.object({
          type: z.literal('remote'),
          url: z.string(),
          headers: z.record(z.string(), z.string()).optional(),
          enabled: z.boolean().optional(),
          oauth: z.union([z.boolean(), z.object({}).passthrough()]).optional(),
          timeout: z.number().optional(),
        }),
      ]),
    ),
  })
  .passthrough();

export type OpenCodeMCPConfig = z.infer<typeof OpenCodeMCPConfig>;

export class OpenCodeMCPClient extends DefaultMCPClient {
  name = 'OpenCode';

  getServerPropertyName(): string {
    return 'mcp';
  }

  async isClientSupported(): Promise<boolean> {
    return Promise.resolve(
      process.platform === 'darwin' ||
        process.platform === 'linux' ||
        process.platform === 'win32',
    );
  }

  async getConfigPath(): Promise<string> {
    // OpenCode's docs document one location for every platform:
    // `~/.config/opencode/opencode.json`. On Linux we honour XDG_CONFIG_HOME
    // when present (OpenCode itself follows XDG); other platforms use the
    // home-relative path the docs specify.
    if (process.platform === 'linux') {
      const xdgConfigHome = runtimeEnv('XDG_CONFIG_HOME');
      if (xdgConfigHome) {
        return Promise.resolve(
          path.join(xdgConfigHome, 'opencode', 'opencode.json'),
        );
      }
    }
    return Promise.resolve(
      path.join(os.homedir(), '.config', 'opencode', 'opencode.json'),
    );
  }

  getServerConfig(
    apiKey: string | undefined,
    selectedFeatures?: string[],
    local?: boolean,
  ): MCPServerConfig {
    // OpenCode supports remote MCP natively (with auto OAuth discovery), so
    // we register a `type: "remote"` entry rather than spawning
    // `mcp-remote` as a subprocess.
    return {
      type: 'remote',
      ...getNativeHTTPServerConfig(apiKey, selectedFeatures, local),
    };
  }
}
