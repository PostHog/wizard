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
import { VisualStudioCodeClient } from './clients/visual-studio-code';
import { ZedClient } from './clients/zed';
import { CodexMCPClient } from './clients/codex';
import { AVAILABLE_FEATURES, ALL_FEATURE_VALUES } from './defaults';
import { debug } from '../../utils/debug';

export const getSupportedClients = async (): Promise<MCPClient[]> => {
  const allClients = [
    new CursorMCPClient(),
    new ClaudeMCPClient(),
    new ClaudeCodeMCPClient(),
    new VisualStudioCodeClient(),
    new ZedClient(),
    new CodexMCPClient(),
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

export const addMCPServerToClientsStep = async ({
  integration,
  cloudRegion,
  askPermission = true,
  local = false,
  ci = false,
}: {
  integration?: Integration;
  cloudRegion?: CloudRegion;
  askPermission?: boolean;
  local?: boolean;
  ci?: boolean;
}): Promise<string[]> => {
  // CI mode: skip MCP installation entirely (default to No)
  if (ci) {
    clack.log.info('Skipping MCP installation (CI mode)');
    return [];
  }

  const region = cloudRegion ?? (await askForCloudRegion());

  const hasPermission = askPermission
    ? await abortIfCancelled(
        clack.select({
          message: local
            ? 'Would you like to install the local development MCP server?'
            : 'Would you like to install the MCP server to use PostHog in your editor?',
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

  const { groupMultiselect } = await import('@clack/prompts');
  const selectedFeatures = await abortIfCancelled(
    groupMultiselect({
      message: `Select which PostHog features to enable as tools: ${chalk.dim(
        '(Toggle: Space, Confirm: Enter, Toggle All: A, Cancel: CTRL + C)',
      )}`,
      options: AVAILABLE_FEATURES,
      initialValues: [...ALL_FEATURE_VALUES],
      required: false,
    }),
    integration,
  );

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

  // Only check for existing installations in the clients the user selected
  const installedClients = [];
  for (const client of clients) {
    if (await client.isServerInstalled(local)) {
      installedClients.push(client);
    }
  }

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

    await removeMCPServer(installedClients, local);
    clack.log.info('Removed existing installation.');
  }

  // Ask user how they want to authenticate
  const authMethod = await abortIfCancelled(
    clack.select({
      message: 'How would you like to authenticate with PostHog?',
      options: [
        {
          value: 'api-key',
          label: 'API Key',
          hint: 'Create a personal API key now',
        },
        {
          value: 'oauth',
          label: 'OAuth (Beta)',
          hint: 'Authenticate when you first use the MCP',
        },
      ],
    }),
    integration,
  );

  const personalApiKey =
    authMethod === 'api-key'
      ? await getPersonalApiKey({ cloudRegion: region })
      : undefined;

  await traceStep('adding mcp servers', async () => {
    await addMCPServer(
      clients,
      personalApiKey,
      selectedFeatures,
      local,
      region,
    );
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
  local = false,
}: {
  integration?: Integration;
  local?: boolean;
}): Promise<string[]> => {
  const installedClients = await getInstalledClients(local);
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
    await removeMCPServer(clientsToRemove, local);
    return clientsToRemove.map((c) => c.name);
  });

  analytics.capture('wizard interaction', {
    action: 'removed mcp servers',
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
  region?: CloudRegion,
): Promise<void> => {
  for (const client of clients) {
    await client.addServer(personalApiKey, selectedFeatures, local, region);
  }
};

export const removeMCPServer = async (
  clients: MCPClient[],
  local?: boolean,
): Promise<void> => {
  for (const client of clients) {
    await client.removeServer(local);
  }
};
