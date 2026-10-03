/** `mcp add` and `mcp remove` with no screens: install to, or remove from, every detected client and print the outcome. */

import type { ConsoleLog } from '@shared/console-log';
import { ALL_FEATURE_VALUES } from '@shared/mcp-clients/defaults';
import { McpClientStatus, namesWithStatus } from '@shared/mcp-clients/results';
import { analytics } from '@utils/analytics';
import { flushAnalytics } from '@utils/flush-analytics';
import { withProgress } from '@utils/telemetry';

/**
 * A scripted caller has no screen to read, so this has to be an exit code.
 * Any failure counts, not just a total wipeout: the step installs to every
 * detected client, so one succeeding would otherwise mask the rest.
 */
export async function addMCPServerToClientsStep(
  args: { local?: boolean; features?: string[]; apiKey?: string },
  { log }: { log: ConsoleLog['log'] },
): Promise<number> {
  const { addMCPServer, getSupportedClients } = await import(
    '@shared/mcp-clients/install'
  );
  const supportedClients = await getSupportedClients();

  if (supportedClients.length === 0) {
    log.info('No supported MCP clients detected. Skipping MCP installation.');
    await flushAnalytics();
    return 1;
  }

  const results = await withProgress('adding mcp servers', () =>
    addMCPServer(
      supportedClients,
      args.apiKey,
      args.features ?? [...ALL_FEATURE_VALUES],
      args.local ?? false,
    ),
  );

  const installed = namesWithStatus(results, McpClientStatus.Changed);
  const already = namesWithStatus(results, McpClientStatus.Unchanged);
  const failed = results.filter((r) => r.status === McpClientStatus.Failed);

  // Report each outcome on its own — a blanket "Added the MCP server to: ..."
  // hid both the no-op re-runs and the outright failures.
  if (installed.length > 0) {
    log.success(`Added the MCP server to:\n${bulletList(installed)}`);
  }
  if (already.length > 0) {
    log.info(
      `The PostHog MCP server was already installed, so nothing changed for:\n${bulletList(
        already,
      )}`,
    );
  }
  if (failed.length > 0) {
    log.warn(
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
  });
  await flushAnalytics();
  return failed.length > 0 || withServer.length === 0 ? 1 : 0;
}

const bulletList = (items: string[]): string =>
  items.map((item) => `  - ${item}`).join('\n');

/** No exit code on an empty result: nothing to remove is the requested end state. */
export async function removeMCPServerFromClientsStep(
  args: { local?: boolean },
  { log }: { log: ConsoleLog['log'] },
): Promise<number> {
  const { getInstalledClients, removeMCPServer } = await import(
    '@shared/mcp-clients/install'
  );
  const local = args.local ?? false;
  const installedClients = await getInstalledClients(local);
  if (installedClients.length === 0) {
    log.info(
      'The PostHog MCP server is not installed for any supported client. Nothing to remove.',
    );
    analytics.wizardCapture('mcp no servers to remove', {});
    await flushAnalytics();
    return 0;
  }

  const results = await withProgress('removing mcp servers', () =>
    removeMCPServer(installedClients, local),
  );

  const removed = namesWithStatus(results, McpClientStatus.Changed);
  const nothingToDo = namesWithStatus(results, McpClientStatus.Unchanged);
  const failed = results.filter((r) => r.status === McpClientStatus.Failed);

  // This step used to print nothing at all, so a non-TTY `mcp remove` gave no
  // hint whether anything happened — let alone whether a client failed.
  if (removed.length > 0) {
    log.success(`Removed the MCP server from:\n${bulletList(removed)}`);
  }
  if (nothingToDo.length > 0) {
    log.info(
      `No PostHog MCP entry left to remove for:\n${bulletList(nothingToDo)}`,
    );
  }
  if (failed.length > 0) {
    log.warn(
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
  });
  await flushAnalytics();
  return 0;
}
