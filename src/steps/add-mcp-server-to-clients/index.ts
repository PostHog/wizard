import type { Integration } from '../../lib/constants';
import { traceStep } from '../../telemetry';
import { analytics } from '../../utils/analytics';
import clack from '../../utils/clack';
import {
  abort,
  abortIfCancelled,
  askForCloudRegion,
} from '../../utils/clack-utils';
import { MCPClient } from './MCPClient';
import { CursorMCPClient } from './clients/cursor';
import { ClaudeMCPClient } from './clients/claude';
import { getPersonalApiKey } from '../../mcp';
import type { CloudRegion } from '../../utils/types';

export const getSupportedClients = async (): Promise<MCPClient[]> => {
  const clients = [new CursorMCPClient(), new ClaudeMCPClient()];
  const supportPromises = clients.map((client) => client.isClientSupported());
  const supportedResults = await Promise.all(supportPromises);
  return clients.filter((_, index) => supportedResults[index]);
};

export const addMCPServerToClientsStep = async ({
  integration,
  cloudRegion,
  askPermission = true,
}: {
  integration?: Integration;
  cloudRegion?: CloudRegion;
  askPermission?: boolean;
}): Promise<string[]> => {
  const region = cloudRegion ?? (await askForCloudRegion());

  if (region === 'eu') {
    if (!askPermission) {
      await abort(
        'The MCP server is not available in the EU region. It is coming soon!',
      );
    }
    return [];
  }

  const hasPermission = askPermission
    ? await abortIfCancelled(
        clack.select({
          message:
            'Would you like to install the PostHog MCP server to use PostHog in your editor?',
          options: [
            { value: true, label: 'Yes' },
            { value: false, label: 'No' },
          ],
        }),
        integration,
      )
    : true;

  if (!hasPermission) {
    return [];
  }

  const clients = await getSupportedClients();

  const installedClients = await getInstalledClients();

  if (installedClients.length > 0) {
    clack.log.warn(
      `The PostHog MCP server is already configured for:

  ${installedClients.map((c) => `- ${c.name}`).join('\n  ')}`,
    );

    const reinstall = await abortIfCancelled(
      clack.select({
        message: 'Would you like to reinstall it?',
        options: [
          {
            value: true,
            label: 'Yes',
            hint: 'Reinstall the MCP server',
          },
          {
            value: false,
            label: 'No',
            hint: 'Keep the existing installation',
          },
        ],
      }),
      integration,
    );

    if (!reinstall) {
      analytics.capture('wizard interaction', {
        action: 'declined to reinstall mcp servers',
        clients: installedClients.map((c) => c.name),
        integration,
      });

      return [];
    }

    await removeMCPServer(installedClients);
    clack.log.info('Removed existing installation.');
  }

  const personalApiKey = await getPersonalApiKey({ cloudRegion: region });

  await traceStep('adding mcp servers', async () => {
    await addMCPServer(clients, personalApiKey);
  });

  clack.log.success(
    `Added the PostHog MCP server to:
  ${clients.map((c) => `- ${c.name}`).join('\n  ')} `,
  );

  analytics.capture('wizard interaction', {
    action: 'added mcp servers',
    clients: clients.map((c) => c.name),
    integration,
  });

  return clients.map((c) => c.name);
};

export const removeMCPServerFromClientsStep = async ({
  integration,
}: {
  integration?: Integration;
}): Promise<string[]> => {
  const installedClients = await getInstalledClients();

  if (installedClients.length === 0) {
    analytics.capture('wizard interaction', {
      action: 'no mcp servers to remove',
      integration,
    });
    return [];
  }

  const removeServers: boolean = await abortIfCancelled(
    clack.select({
      message: `Found the PostHog MCP server in ${installedClients.length} clients. Would you like to remove it?`,
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
      clients: installedClients.map((c) => c.name),
      integration,
    });

    await abort('The MCP server was not removed.');
    return [];
  }

  const results = await traceStep('removing mcp servers', async () => {
    await removeMCPServer(installedClients);

    return installedClients.map((c) => c.name);
  });

  analytics.capture('wizard interaction', {
    action: 'removed mcp servers',
    clients: results,
    integration,
  });

  return results;
};

export const getInstalledClients = async (): Promise<MCPClient[]> => {
  const clients = await getSupportedClients();

  const installedClients: MCPClient[] = [];

  for (const client of clients) {
    if (await client.isServerInstalled()) {
      installedClients.push(client);
    }
  }

  return installedClients;
};

export const addMCPServer = async (
  clients: MCPClient[],
  personalApiKey: string,
): Promise<void> => {
  for (const client of clients) {
    await client.addServer(personalApiKey);
  }
};

export const removeMCPServer = async (clients: MCPClient[]): Promise<void> => {
  for (const client of clients) {
    await client.removeServer();
  }
};
