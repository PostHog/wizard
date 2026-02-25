import chalk from 'chalk';
import {
  addMCPServerToClientsStep,
  removeMCPServerFromClientsStep,
} from './steps/add-mcp-server-to-clients';
import { getUI } from './ui';
import type { CloudRegion } from './utils/types';
import { enableDebugLogs } from './utils/debug';

export const runMCPInstall = async (options: {
  signup: boolean;
  region?: CloudRegion;
  local?: boolean;
  debug?: boolean;
}) => {
  if (options.debug) {
    enableDebugLogs();
  }
  getUI().intro(
    chalk.bgGreenBright(
      `Installing the PostHog MCP server ${options.local && '(local)'}`,
    ),
  );

  await addMCPServerToClientsStep({
    cloudRegion: options.region,
    askPermission: false,
    local: options.local,
  });

  getUI().log.info(
    `${chalk.greenBright(
      'You might need to restart your MCP clients to see the changes.',
    )}`,
  );

  getUI().log.info(
    `You'll be prompted to log in to PostHog when you first use the MCP.`,
  );

  getUI().log.info(`Get started with some prompts like:
- What feature flags do I have active?
- Add a new feature flag for our homepage redesign
- What are my most common errors?`);

  getUI().log.info(`Check out our MCP Server documentation:
${chalk.blueBright(`https://posthog.com/docs/model-context-protocol`)}`);
};

export const runMCPRemove = async (options?: { local?: boolean }) => {
  getUI().intro(chalk.bgRed('Removing the PostHog MCP server'));
  const results = await removeMCPServerFromClientsStep({
    local: options?.local,
  });

  if (results.length === 0) {
    getUI().outro(`No PostHog MCP servers found to remove.`);
    return;
  }

  getUI().log.success(`PostHog MCP server removed from:`);
  results.map((c) => getUI().log.info(`- ${c}`));
  getUI().outro(
    `${chalk.green(
      'You might need to restart your MCP clients to see the changes.\n\n',
    )}`,
  );
};
