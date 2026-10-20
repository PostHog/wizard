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
  getSupportedPluginClients,
  installPlugins as runPluginInstall,
} from '@shared/mcp-clients/install';
import { ALL_FEATURE_VALUES } from '@shared/mcp-clients/defaults';
import {
  McpClientStatus,
  namesWithStatus,
  redactSecrets,
  toClientResult,
  type McpClientResult,
} from '@shared/mcp-clients/results';
import type { MCPClient } from '@shared/mcp-clients/MCPClient';
import { isPluginCapable } from '@shared/mcp-clients/plugin-client';
import { isLoginCapable } from '@shared/mcp-clients/login-client';
import { isBrowserFinishable } from '@shared/mcp-clients/browser-client';
import { logToFile } from '@utils/debug';
import { analytics } from '@utils/analytics';

/** Where the install lives: a config on this computer, or a connector in the user's account. */
export type McpClientKind = 'local' | 'account';

export interface McpClientInfo {
  name: string;
  kind: McpClientKind;
  supportsPlugin: boolean;
  /** True when the plugin already ships the posthog MCP server (no direct entry needed). */
  pluginBundlesMcp: boolean;
  /**
   * Set for clients connected by opening a hosted page in the browser. The
   * Done screen renders this so the user knows to finish setup in the browser.
   */
  finish?: { url: string; instruction: string };
  /** The editor's own login command (e.g. `claude mcp login posthog`), the one manual step left. */
  loginCommand?: string;
  /** Same, for the plugin-provided server (e.g. `claude mcp login plugin:posthog:posthog`). */
  pluginLoginCommand?: string;
}

export { McpClientStatus };
export type { McpClientResult };

export interface McpInstaller {
  /** Detect which MCP-capable editors are available on this machine. */
  detectClients(): Promise<McpClientInfo[]>;

  /**
   * Install the PostHog MCP server to the given clients. Returns one result per
   * client — including the ones that were already installed and the ones that
   * failed, so the screen can say which happened and why.
   */
  install(
    clientNames: string[],
    features?: string[],
    apiKey?: string,
  ): Promise<McpClientResult[]>;

  /** The local clients that have the PostHog MCP server or plugin installed. */
  detectInstalled(local?: boolean): Promise<McpClientInfo[]>;

  /**
   * Remove the PostHog MCP server from the given installed clients. Returns one
   * result per client so a failed removal isn't reported as a success.
   */
  remove(clientNames: string[], local?: boolean): Promise<McpClientResult[]>;

  /** Install the PostHog AI plugin to supported clients. Best-effort: failures do not affect MCP outcome. */
  installPlugins(clientNames: string[]): Promise<McpClientResult[]>;
}

/**
 * Production McpInstaller backed by real MCP client detection and installation.
 */
const toClientInfo = (c: MCPClient): McpClientInfo => ({
  name: c.name,
  kind: isBrowserFinishable(c) ? 'account' : 'local',
  supportsPlugin: isPluginCapable(c) && c.supportsPlugin(),
  pluginBundlesMcp: isPluginCapable(c) && c.pluginBundlesMcpServer(),
  finish: isBrowserFinishable(c)
    ? { url: c.connectorUrl, instruction: c.finishInstruction }
    : undefined,
  loginCommand: (isLoginCapable(c) && c.loginCommand(false)) || undefined,
  pluginLoginCommand:
    (isLoginCapable(c) && c.pluginLoginCommand?.()) || undefined,
});

export function createMcpInstaller(): McpInstaller {
  // Cache the raw MCPClient objects so install() can reference them by name
  let cachedClients: Array<{ name: string; raw: unknown }> = [];
  // Same for remove(): the clients detectInstalled() found.
  let installedClients: MCPClient[] = [];

  return {
    async detectClients(): Promise<McpClientInfo[]> {
      const supported = await getSupportedClients();
      cachedClients = supported.map((c) => ({ name: c.name, raw: c }));
      return supported.map(toClientInfo);
    },

    async detectInstalled(local?: boolean): Promise<McpClientInfo[]> {
      // Account clients live in the user's account, so there is nothing local
      // to remove; they never report installed, and this keeps it that way.
      installedClients = (await getInstalledClients(local)).filter(
        (c) => !isBrowserFinishable(c),
      );
      return installedClients.map(toClientInfo);
    },

    async install(
      clientNames: string[],
      features?: string[],
      apiKey?: string,
    ): Promise<McpClientResult[]> {
      const resolvedFeatures = features ?? [...ALL_FEATURE_VALUES];
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

      const results: McpClientResult[] = [];
      for (const client of toInstall) {
        const name = client.name as string;
        try {
          const result = await client.addServer(
            apiKey,
            resolvedFeatures,
            false,
          );
          results.push(toClientResult(name, result));
          if (!result?.success) {
            // redactSecrets, not the raw reason: the CLIs we shell out to echo
            // the Authorization header back in their error output.
            logToFile(
              `[McpInstaller] addServer returned success=false for ${name}: ${redactSecrets(
                result?.reason ?? 'no reason given',
              )}`,
            );
          }
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          logToFile(
            `[McpInstaller] addServer threw for ${name}: ${redactSecrets(
              reason,
            )}`,
          );
          results.push(toClientResult(name, { success: false, reason }));
        }
      }
      return results;
    },

    async remove(
      clientNames: string[],
      local?: boolean,
    ): Promise<McpClientResult[]> {
      // `local` was dropped here, so `mcp remove --local` looked at (and
      // reported on) the wrong server name.
      const selected = installedClients.filter((c) =>
        clientNames.includes(c.name),
      );
      if (selected.length === 0) return [];
      return removeMCPServer(selected, local);
    },

    async installPlugins(clientNames: string[]): Promise<McpClientResult[]> {
      const rawClients = cachedClients
        .filter((c) => clientNames.includes(c.name))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((c) => c.raw as any);

      const pluginClients = getSupportedPluginClients(rawClients);
      const results = await runPluginInstall(pluginClients);

      const already = namesWithStatus(results, McpClientStatus.Unchanged);
      analytics.wizardCapture('mcp plugins installed', {
        // `clients` keeps its original meaning — every client that ended up with
        // the plugin — so existing insights don't dip when a re-run reports
        // already-installed instead of a fresh write.
        clients: [
          ...namesWithStatus(results, McpClientStatus.Changed),
          ...already,
        ],
        already_installed: already,
        attempted: pluginClients.map((c) => c.name),
      });

      return results;
    },
  };
}
