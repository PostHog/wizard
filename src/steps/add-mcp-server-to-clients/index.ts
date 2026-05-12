import type { Integration } from '../../lib/constants';
import type { CloudRegion } from '../../utils/types';
import { traceStep } from '../../telemetry';
import { analytics } from '../../utils/analytics';
import { getUI } from '../../ui';
import { MCPClient } from './MCPClient';
import { CursorMCPClient } from './clients/cursor';
import { ClaudeCodeMCPClient } from './clients/claude-code';
import { VisualStudioCodeClient } from './clients/visual-studio-code';
import { ZedClient } from './clients/zed';
import { CodexMCPClient } from './clients/codex';
import { ALL_FEATURE_VALUES } from './defaults';
import { debug } from '../../utils/debug';
import {
  DEFAULT_PLUGIN_SCOPE,
  isPluginCapable,
  PluginCapable,
  PluginScope,
} from './plugin-client';

export const getSupportedClients = async (): Promise<MCPClient[]> => {
  const allClients = [
    new ClaudeCodeMCPClient(),
    new CodexMCPClient(),
    new CursorMCPClient(),
    new VisualStudioCodeClient(),
    new ZedClient(),
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

/**
 * Add MCP server to clients. No prompts — pure orchestration.
 * Prompts are handled by McpScreen (TUI) or auto-accepted (CI).
 */
export const addMCPServerToClientsStep = async ({
  integration,
  local = false,
  ci = false,
  cloudRegion: _cloudRegion,
  features,
  apiKey,
}: {
  integration?: Integration;
  local?: boolean;
  ci?: boolean;
  cloudRegion?: CloudRegion;
  features?: string[];
  apiKey?: string;
}): Promise<string[]> => {
  const ui = getUI();

  // CI mode: skip MCP installation entirely
  if (ci) {
    ui.log.info('Skipping MCP installation (CI mode)');
    return [];
  }

  const supportedClients = await getSupportedClients();

  if (supportedClients.length === 0) {
    ui.log.info(
      'No supported MCP clients detected. Skipping MCP installation.',
    );
    return [];
  }

  // Auto-install to all supported clients
  await traceStep('adding mcp servers', async () => {
    await addMCPServer(
      supportedClients,
      apiKey,
      features ?? [...ALL_FEATURE_VALUES],
      local,
    );
  });

  ui.log.success(
    `Added the MCP server to:
  ${supportedClients.map((c) => `- ${c.name}`).join('\n  ')} `,
  );

  analytics.wizardCapture('mcp servers added', {
    clients: supportedClients.map((c) => c.name),
    integration,
  });

  return supportedClients.map((c) => c.name);
};

export const removeMCPServerFromClientsStep = async ({
  integration,
  local = false,
}: {
  integration?: Integration;
  local?: boolean;
}): Promise<string[]> => {
  const installedClients = await getInstalledClients(local);
  if (installedClients.length === 0) {
    analytics.wizardCapture('mcp no servers to remove', {
      integration,
    });
    return [];
  }

  // Auto-remove from all installed clients
  const results = await traceStep('removing mcp servers', async () => {
    await removeMCPServer(installedClients, local);
    return installedClients.map((c) => c.name);
  });

  analytics.wizardCapture('mcp servers removed', {
    clients: results,
    integration,
  });

  return results;
};

export const getInstalledClients = async (
  local?: boolean,
): Promise<MCPClient[]> => {
  const clients = await getSupportedClients();
  const installedClients: MCPClient[] = [];

  for (const client of clients) {
    if (await client.isServerInstalled(local)) {
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
): Promise<void> => {
  for (const client of clients) {
    await client.addServer(personalApiKey, selectedFeatures, local);
  }
};

export const getSupportedPluginClients = (
  clients: MCPClient[],
): Array<MCPClient & PluginCapable> => {
  return clients.filter(isPluginCapable).filter((c) => c.supportsPlugin());
};

export const installPlugins = async (
  clients: Array<MCPClient & PluginCapable>,
  scope: PluginScope = DEFAULT_PLUGIN_SCOPE,
): Promise<string[]> => {
  const installed: string[] = [];
  for (const client of clients) {
    try {
      const result = await client.installPlugin(scope);
      if (result.success) installed.push(client.name);
    } catch (err) {
      debug(`[installPlugins] installPlugin threw for ${client.name}: ${err}`);
    }
  }
  return installed;
};

export const removeMCPServer = async (
  clients: MCPClient[],
  local?: boolean,
): Promise<void> => {
  for (const client of clients) {
    await client.removeServer(local);
  }
};
