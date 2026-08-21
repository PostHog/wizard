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
} from '@steps/add-mcp-server-to-clients/index';
import { ALL_FEATURE_VALUES } from '@steps/add-mcp-server-to-clients/defaults';
import {
  McpClientStatus,
  namesWithStatus,
  redactSecrets,
  toClientResult,
  type McpClientResult,
} from '@steps/add-mcp-server-to-clients/results';
import { isPluginCapable } from '@steps/add-mcp-server-to-clients/plugin-client';
import { isLoginCapable } from '@steps/add-mcp-server-to-clients/login-client';
import { isBrowserFinishable } from '@steps/add-mcp-server-to-clients/browser-client';
import { logToFile } from '@utils/debug';
import { analytics } from '@utils/analytics';

export interface McpClientInfo {
  name: string;
  supportsPlugin: boolean;
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

  /**
   * Remove the PostHog MCP server from every client that has it. Returns one
   * result per client so a failed removal isn't reported as a success.
   */
  remove(local?: boolean): Promise<McpClientResult[]>;

  /** Install the PostHog AI plugin to supported clients. Best-effort: failures do not affect MCP outcome. */
  installPlugins(clientNames: string[]): Promise<McpClientResult[]>;
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
      return supported.map((c) => ({
        name: c.name,
        supportsPlugin: isPluginCapable(c) && c.supportsPlugin(),
        finish: isBrowserFinishable(c)
          ? { url: c.connectorUrl, instruction: c.finishInstruction }
          : undefined,
        loginCommand: isLoginCapable(c) ? c.loginCommand(false) : undefined,
        pluginLoginCommand: isLoginCapable(c)
          ? c.pluginLoginCommand?.()
          : undefined,
      }));
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

    async remove(local?: boolean): Promise<McpClientResult[]> {
      // `local` was dropped here, so `mcp remove --local` looked at (and
      // reported on) the wrong server name.
      const installed = await getInstalledClients(local);
      if (installed.length === 0) return [];
      return removeMCPServer(installed, local);
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
