import type { Integration } from '../../lib/constants';
import { traceStep } from '../../telemetry';
import { analytics } from '../../utils/analytics';
import clack from '../../utils/clack';
import { abortIfCancelled } from '../../utils/clack-utils';
import { MCPClient } from './MCPClient';
import { CursorMCPClient } from './clients/cursor';
import { ClaudeMCPClient } from './clients/claude';

export const getSupportedClients = (): MCPClient[] => {
  return [new CursorMCPClient(), new ClaudeMCPClient()].filter((client) =>
    client.isClientSupported(),
  );
};

export const addMCPServerToClientsStep = async (
  apiKey: string,
  {
    integration,
  }: {
    integration?: Integration;
  },
): Promise<string[]> => {
  const clients = getSupportedClients();

  const clientsToAdd: MCPClient[] = [];

  for (const client of clients) {
    const isServerInstalled = await client.isServerInstalled();
    if (!isServerInstalled) {
      clientsToAdd.push(client);
    }
  }

  if (clientsToAdd.length === 0) {
    clack.log.info(
      `The PostHog MCP server is already configured for:
  ${clients.map((c) => `- ${c.name}`).join('\n  ')}`,
    );
    analytics.capture('wizard interaction', {
      action: 'mcp servers already configured',
      integration,
    });
    return [];
  }

  const results = await traceStep('adding mcp servers', async () => {
    const addedClients: string[] = [];

    for (const client of clientsToAdd) {
      try {
        await client.addServer(apiKey);
        addedClients.push(client.constructor.name);
      } catch (error) {
        //
      }
    }

    return addedClients;
  });

  clack.log.success(
    `Added PostHog MCP server to:
  ${clientsToAdd.map((c) => `- ${c.name}`).join('\n  ')}`,
  );

  analytics.capture('wizard interaction', {
    action: 'added mcp servers',
    clients: results,
    integration,
  });

  return results;
};

export const removeMCPServerFromClientsStep = async ({
  integration,
}: {
  integration?: Integration;
}): Promise<string[]> => {
  const clients = getSupportedClients();

  const clientsWithServer: MCPClient[] = [];

  for (const client of clients) {
    if (await client.isServerInstalled()) {
      clientsWithServer.push(client);
    }
  }

  if (clientsWithServer.length === 0) {
    analytics.capture('wizard interaction', {
      action: 'no mcp servers to remove',
      integration,
    });
    return [];
  }

  const clientNames = clientsWithServer.map((c) => c.name).join(', ');

  const removeServers: boolean = await abortIfCancelled(
    clack.select({
      message: `Found the PostHog MCP server in ${clientsWithServer.length} clients (${clientNames}). Would you like to remove it?`,
      options: [
        {
          value: true,
          label: 'Yes',
          hint: `Remove PostHog MCP server`,
        },
        {
          value: false,
          label: 'No',
          hint: 'Keep the MCP server configuration',
        },
      ],
    }),
    integration,
  );

  if (!removeServers) {
    analytics.capture('wizard interaction', {
      action: 'declined to remove mcp servers',
      clients: clientsWithServer.map((c) => c.constructor.name),
      integration,
    });
    return [];
  }

  const results = await traceStep('removing mcp servers', async () => {
    const removedClients: string[] = [];

    for (const client of clientsWithServer) {
      try {
        await client.removeServer();
        removedClients.push(client.name);
      } catch (error) {
        //
      }
    }

    return removedClients;
  });

  analytics.capture('wizard interaction', {
    action: 'removed mcp servers',
    clients: results,
    integration,
  });

  return results;
};
