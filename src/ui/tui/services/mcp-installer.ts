/**
 * McpInstaller — service layer between McpScreen and MCP business logic.
 *
 * Decouples the screen from step internals. Testable, swappable,
 * no dynamic imports in React components.
 */

import {
  getSupportedClients,
  removeMCPServer,
  getInstalledClients,
} from '../../../steps/add-mcp-server-to-clients/index.js';
import { ALL_FEATURE_VALUES } from '../../../steps/add-mcp-server-to-clients/defaults.js';
import { logToFile } from '../../../utils/debug.js';

export interface McpClientInfo {
  name: string;
}

export interface McpInstaller {
  /** Detect which MCP-capable editors are available on this machine. */
  detectClients(): Promise<McpClientInfo[]>;

  /** Install the PostHog MCP server to the given clients. Returns names of successfully installed clients. */
  install(clientNames: string[]): Promise<string[]>;

  /** Remove the PostHog MCP server from all installed clients. Returns names of removed clients. */
  remove(): Promise<string[]>;
}

/**
 * Production McpInstaller backed by real MCP client detection and installation.
 */
export function createMcpInstaller(): McpInstaller {
  // Cache the raw MCPClient objects so install() can reference them by name
  let cachedClients: Array<{ name: string; raw: unknown }> = [];

  return {
    async detectClients(): Promise<McpClientInfo[]> {
      const supported = await getSupportedClients();
      cachedClients = supported.map((c) => ({ name: c.name, raw: c }));
      return supported.map((c) => ({ name: c.name }));
    },

    async install(clientNames: string[]): Promise<string[]> {
      const features = [...ALL_FEATURE_VALUES];
      const toInstall = cachedClients
        .filter((c) => clientNames.includes(c.name))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((c) => c.raw as any);

      if (toInstall.length === 0) {
        logToFile(
          `[McpInstaller] No clients matched. clientNames=${JSON.stringify(
            clientNames,
          )}, cached=${JSON.stringify(cachedClients.map((c) => c.name))}`,
        );
        return [];
      }

      const installed: string[] = [];
      for (const client of toInstall) {
        try {
          const result = await client.addServer(undefined, features, false);
          if (result?.success) {
            installed.push(client.name as string);
          } else {
            logToFile(
              `[McpInstaller] addServer returned success=false for ${client.name}`,
            );
          }
        } catch (err) {
          logToFile(
            `[McpInstaller] addServer threw for ${client.name}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
      return installed;
    },

    async remove(): Promise<string[]> {
      const installed = await getInstalledClients();
      if (installed.length === 0) return [];
      await removeMCPServer(installed);
      return installed.map((c) => c.name);
    },
  };
}
