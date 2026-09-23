import { MCPClient } from './MCPClient';
import { CursorMCPClient } from './clients/cursor';
import { ClaudeCodeMCPClient } from './clients/claude-code';
import { ClaudeWebMCPClient } from './clients/claude-web';
import { VisualStudioCodeClient } from './clients/visual-studio-code';
import { ZedClient } from './clients/zed';
import { CodexMCPClient } from './clients/codex';
import { OpenCodeMCPClient } from './clients/opencode';
import { debug } from '@utils/debug';
import { isPluginCapable, PluginCapable } from './plugin-client';
import { toClientResult, type McpClientResult } from './results';

export const getSupportedClients = async (): Promise<MCPClient[]> => {
  const allClients = [
    new ClaudeCodeMCPClient(),
    new ClaudeWebMCPClient(),
    new CodexMCPClient(),
    new CursorMCPClient(),
    new VisualStudioCodeClient(),
    new ZedClient(),
    new OpenCodeMCPClient(),
  ];
  const supportedClients: MCPClient[] = [];

  debug('Checking for supported MCP clients...');
  for (const client of allClients) {
    const isSupported = await client.isClientSupported();
    debug(`${client.name}: ${isSupported ? '✓ supported' : '✗ not supported'}`);
    if (isSupported) {
      supportedClients.push(client);
    }
  }
  debug(
    `Found ${supportedClients.length} supported client(s): ${supportedClients
      .map((c) => c.name)
      .join(', ')}`,
  );

  return supportedClients;
};

export const getInstalledClients = async (
  local?: boolean,
): Promise<MCPClient[]> => {
  const clients = await getSupportedClients();
  const installedClients: MCPClient[] = [];

  for (const client of clients) {
    // The plugin bundles its own posthog MCP server, so for removal purposes a
    // plugin install counts as installed even with no config entry (`--local`
    // targets only the local-dev entry and leaves the plugin alone).
    const pluginInstalled =
      !local && isPluginCapable(client) && (await client.isPluginInstalled());
    if ((await client.isServerInstalled(local)) || pluginInstalled) {
      installedClients.push(client);
    }
  }

  return installedClients;
};

export const addMCPServer = async (
  clients: MCPClient[],
  personalApiKey?: string,
  selectedFeatures?: string[],
  local?: boolean,
): Promise<McpClientResult[]> => {
  const results: McpClientResult[] = [];
  for (const client of clients) {
    try {
      const result = await client.addServer(
        personalApiKey,
        selectedFeatures,
        local,
      );
      results.push(toClientResult(client.name, result));
    } catch (err) {
      debug(`[addMCPServer] addServer threw for ${client.name}: ${err}`);
      results.push(
        toClientResult(client.name, {
          success: false,
          reason: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
  return results;
};

export const getSupportedPluginClients = (
  clients: MCPClient[],
): Array<MCPClient & PluginCapable> => {
  return clients.filter(isPluginCapable).filter((c) => c.supportsPlugin());
};

export const installPlugins = async (
  clients: Array<MCPClient & PluginCapable>,
): Promise<McpClientResult[]> => {
  const results: McpClientResult[] = [];
  for (const client of clients) {
    try {
      results.push(toClientResult(client.name, await client.installPlugin()));
    } catch (err) {
      debug(`[installPlugins] installPlugin threw for ${client.name}: ${err}`);
      results.push(
        toClientResult(client.name, {
          success: false,
          reason: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
  return results;
};

export const removeMCPServer = async (
  clients: MCPClient[],
  local?: boolean,
): Promise<McpClientResult[]> => {
  const results: McpClientResult[] = [];
  for (const client of clients) {
    try {
      let result = await client.removeServer(local);
      // The plugin bundles its own posthog server — leaving it installed makes
      // the removal a lie (`--local` never touches the plugin).
      if (!local && isPluginCapable(client) && client.removePlugin) {
        const plugin = await client.removePlugin();
        result =
          !result.success || !plugin.success
            ? {
                success: false,
                reason: [result.reason, plugin.reason]
                  .filter(Boolean)
                  .join('; '),
              }
            : {
                success: true,
                ...(result.alreadyInstalled && plugin.alreadyInstalled
                  ? { alreadyInstalled: true }
                  : {}),
              };
      }
      results.push(toClientResult(client.name, result));
    } catch (err) {
      debug(`[removeMCPServer] removeServer threw for ${client.name}: ${err}`);
      results.push(
        toClientResult(client.name, {
          success: false,
          reason: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
  return results;
};
