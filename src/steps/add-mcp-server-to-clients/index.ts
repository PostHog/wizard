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
import { isLoginCapable } from './login-client';
import {
  McpClientStatus,
  namesWithStatus,
  toClientResult,
  type InstallResult,
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
}: {
  integration?: Integration;
  local?: boolean;
  ci?: boolean;
  cloudRegion?: CloudRegion;
  features?: string[];
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
    addMCPServer(supportedClients, features ?? [...ALL_FEATURE_VALUES], local),
  );

  const installed = namesWithStatus(results, McpClientStatus.Changed);
  const already = namesWithStatus(results, McpClientStatus.Unchanged);
  const failed = results.filter((r) => r.status === McpClientStatus.Failed);

  // Report each outcome on its own — a blanket "Added the MCP server to: ..."
  // hid both the no-op re-runs and the outright failures.
  if (installed.length > 0) {
    ui.log.success(`Added the MCP server to:\n${bulletList(installed)}`);
  }
  const logins = loginCommands(supportedClients, results, local);
  if (logins.length > 0) {
    ui.log.info(
      `One step left — authenticate in your editor (nothing prompts you automatically):\n${bulletList(
        logins,
      )}`,
    );
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
  const ui = getUI();
  const installedClients = await getInstalledClients(local);
  if (installedClients.length === 0) {
    ui.log.info(
      'The PostHog MCP server is not installed for any supported client. Nothing to remove.',
    );
    analytics.wizardCapture('mcp no servers to remove', {
      integration,
    });
    return [];
  }

  // Auto-remove from all installed clients
  const results = await withProgress('removing mcp servers', () =>
    removeMCPServer(installedClients, local),
  );

  const removed = namesWithStatus(results, McpClientStatus.Changed);
  const nothingToDo = namesWithStatus(results, McpClientStatus.Unchanged);
  const failed = results.filter((r) => r.status === McpClientStatus.Failed);

  // This step used to print nothing at all, so a non-TTY `mcp remove` gave no
  // hint whether anything happened — let alone whether a client failed.
  if (removed.length > 0) {
    ui.log.success(`Removed the MCP server from:\n${bulletList(removed)}`);
  }
  if (nothingToDo.length > 0) {
    ui.log.info(
      `No PostHog MCP entry left to remove for:\n${bulletList(nothingToDo)}`,
    );
  }
  if (failed.length > 0) {
    ui.log.warn(
      `Couldn't remove the MCP server from:\n${bulletList(
        failed.map((r) => (r.detail ? `${r.name} — ${r.detail}` : r.name)),
      )}`,
    );
  }

  analytics.wizardCapture('mcp servers removed', {
    clients: removed,
    nothing_to_remove_clients: nothingToDo,
    failed_clients: failed.map((r) => r.name),
    attempted_clients: installedClients.map((c) => c.name),
    integration,
  });

  return removed;
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
  selectedFeatures?: string[],
  local?: boolean,
): Promise<McpClientResult[]> => {
  const results: McpClientResult[] = [];
  for (const client of clients) {
    try {
      const result = await client.addServer(selectedFeatures, local);
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

// One report per client: a failure on either half wins, a change on either
// half counts as removed, and "nothing to do" only when both halves had
// nothing to do.
const mergeRemovals = (
  entry: InstallResult,
  plugin: InstallResult,
): InstallResult => {
  if (!entry.success || !plugin.success) {
    return {
      success: false,
      reason: [entry.reason, plugin.reason].filter(Boolean).join('; '),
    };
  }
  return {
    success: true,
    ...(entry.alreadyInstalled && plugin.alreadyInstalled
      ? { alreadyInstalled: true }
      : {}),
  };
};

/**
 * The exact editor-owned login command for every login-capable client that
 * just got a fresh entry. The editor CLI runs its own OAuth and owns the token
 * and its refresh; its login command requires a real terminal, so the wizard
 * surfaces it instead of running it.
 */
export const loginCommands = (
  clients: MCPClient[],
  results: McpClientResult[],
  local?: boolean,
): string[] => {
  const changed = new Set(namesWithStatus(results, McpClientStatus.Changed));
  return clients
    .filter((c) => changed.has(c.name) && isLoginCapable(c))
    .map((c) => c.loginCommand(local));
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
        result = mergeRemovals(result, await client.removePlugin());
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
