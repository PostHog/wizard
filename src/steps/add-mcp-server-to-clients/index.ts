import type { Integration } from '../../lib/constants';
import { traceStep } from '../../telemetry';
import { analytics } from '../../utils/analytics';
import clack from '../../utils/clack';
import chalk from 'chalk';
import { abortIfCancelled, askForCloudRegion } from '../../utils/clack-utils';
import { MCPClient } from './MCPClient';
import { CursorMCPClient } from './clients/cursor';
import { ClaudeMCPClient } from './clients/claude';
import { getPersonalApiKey } from '../../mcp';
import type { CloudRegion } from '../../utils/types';
import { ClaudeCodeMCPClient } from './clients/claude-code';

export const getSupportedClients = async (): Promise<MCPClient[]> => {
  const allClients = [
    new CursorMCPClient(),
    new ClaudeMCPClient(),
    new ClaudeCodeMCPClient(),
  ];
  const supportedClients: MCPClient[] = [];

  for (const client of allClients) {
    if (await client.isClientSupported()) {
      supportedClients.push(client);
    }
  }

  return supportedClients;
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

  const hasPermission = askPermission
    ? await abortIfCancelled(
        clack.select({
          message:
            'Would you like to install the MCP server to use PostHog in your editor?',
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

  const supportedClients = await getSupportedClients();

  const { multiselect } = await import('@clack/prompts');
  const selectedClientNames = await abortIfCancelled(
    multiselect({
      message: `Select which MCP clients to install the MCP server to: ${chalk.dim(
        '(Toggle: Space, Confirm: Enter, Toggle All: A, Cancel: CTRL + C)',
      )}`,
      options: supportedClients.map((client) => ({
        value: client.name,
        label: client.name,
      })),
      initialValues: supportedClients.map((client) => client.name),
      required: true,
    }),
    integration,
  );

  const clients = supportedClients.filter((client) =>
    selectedClientNames.includes(client.name),
  );

  const installedClients = await getInstalledClients();

  if (installedClients.length > 0) {
    clack.log.warn(
      `The MCP server is already configured for:
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
    `Added the MCP server to:
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

  const { multiselect } = await import('@clack/prompts');
  const selectedClientNames = await abortIfCancelled(
    multiselect({
      message: `Select which clients to remove the MCP server from: ${chalk.dim(
        '(Toggle: Space, Confirm: Enter, Toggle All: A, Cancel: CTRL + C)',
      )}`,
      options: installedClients.map((client) => ({
        value: client.name,
        label: client.name,
      })),
      initialValues: installedClients.map((client) => client.name),
    }),
    integration,
  );

  const clientsToRemove = installedClients.filter((client) =>
    selectedClientNames.includes(client.name),
  );

  if (clientsToRemove.length === 0) {
    analytics.capture('wizard interaction', {
      action: 'no mcp servers selected for removal',
      integration,
    });
    return [];
  }

  const results = await traceStep('removing mcp servers', async () => {
    await removeMCPServer(clientsToRemove);
    return clientsToRemove.map((c) => c.name);
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
