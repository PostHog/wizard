import type { Integration } from '@shared/constants';
import type { CloudRegion } from '@utils/types';
import { withProgress } from '@utils/telemetry';
import { analytics } from '@utils/analytics';
import { getUI } from '@ui';
import {
  addMCPServer,
  getInstalledClients,
  getSupportedClients,
  removeMCPServer,
} from '@tui/add-mcp-server-to-clients/index';
import { ALL_FEATURE_VALUES } from '@tui/add-mcp-server-to-clients/defaults';
import {
  McpClientStatus,
  namesWithStatus,
} from '@tui/add-mcp-server-to-clients/results';

/** Per-client outcome, so a scripted caller can turn a failure into an exit code. */
export interface McpStepOutcome {
  /** Clients that ended up with the server, whether we wrote it or it was already there. */
  installed: string[];
  failed: string[];
}

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
}): Promise<McpStepOutcome> => {
  const ui = getUI();

  // CI mode: skip MCP installation entirely
  if (ci) {
    ui.log.info('Skipping MCP installation (CI mode)');
    return { installed: [], failed: [] };
  }

  const supportedClients = await getSupportedClients();

  if (supportedClients.length === 0) {
    ui.log.info(
      'No supported MCP clients detected. Skipping MCP installation.',
    );
    return { installed: [], failed: [] };
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

  const installed = namesWithStatus(results, McpClientStatus.Changed);
  const already = namesWithStatus(results, McpClientStatus.Unchanged);
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

  return { installed: withServer, failed: failed.map((r) => r.name) };
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
