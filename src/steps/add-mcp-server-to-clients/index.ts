import type { Integration } from '@lib/constants';
import type { CloudRegion } from '@utils/types';
import { withProgress } from '../../telemetry';
import { analytics } from '@utils/analytics';
import { getUI } from '@ui';
import { MCPClient } from './MCPClient';
import { CursorMCPClient } from './clients/cursor';
import { ClaudeCodeMCPClient } from './clients/claude-code';
import { ClaudeWebMCPClient } from './clients/claude-web';
import { VisualStudioCodeClient } from './clients/visual-studio-code';
import { ZedClient } from './clients/zed';
import { CodexMCPClient } from './clients/codex';
import { OpenCodeMCPClient } from './clients/opencode';
import { ALL_FEATURE_VALUES } from './defaults';
import { debug } from '@utils/debug';
import { isPluginCapable, PluginCapable } from './plugin-client';
import {
  McpClientStatus,
  namesWithStatus,
  toClientResult,
  type McpClientResult,
} from './results';

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
  const results = await withProgress('adding mcp servers', () =>
    addMCPServer(
      supportedClients,
      apiKey,
      features ?? [...ALL_FEATURE_VALUES],
      local,
    ),
  );

  const installed = namesWithStatus(results, McpClientStatus.Installed);
  const already = namesWithStatus(results, McpClientStatus.AlreadyInstalled);
  const failed = results.filter((r) => r.status === McpClientStatus.Failed);

  // Report each outcome on its own — a blanket "Added the MCP server to: ..."
  // hid both the no-op re-runs and the outright failures.
  if (installed.length > 0) {
    ui.log.success(`Added the MCP server to:\n${bulletList(installed)}`);
  }
  if (already.length > 0) {
    ui.log.info(
      `The PostHog MCP server was already installed, so nothing changed for:\n${bulletList(
        already,
      )}`,
    );
  }
  if (failed.length > 0) {
    ui.log.warn(
      `Couldn't add the MCP server to:\n${bulletList(
        failed.map((r) => (r.detail ? `${r.name} — ${r.detail}` : r.name)),
      )}`,
    );
  }

  const withServer = [...installed, ...already];

  analytics.wizardCapture('mcp servers added', {
    // `clients` stays "every client that ended up with the MCP server", which is
    // what it meant before — the new properties break that down.
    clients: withServer,
    already_installed_clients: already,
    failed_clients: failed.map((r) => r.name),
    attempted_clients: supportedClients.map((c) => c.name),
    integration,
  });

  return withServer;
};

const bulletList = (items: string[]): string =>
  items.map((item) => `  - ${item}`).join('\n');

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
  const results = await withProgress('removing mcp servers', async () => {
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
): Promise<void> => {
  for (const client of clients) {
    await client.removeServer(local);
  }
};
