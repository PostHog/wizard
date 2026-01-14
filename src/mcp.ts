import chalk from 'chalk';
import {
  addMCPServerToClientsStep,
  removeMCPServerFromClientsStep,
} from './steps/add-mcp-server-to-clients';
import clack from './utils/clack';
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
  clack.intro(
    chalk.bgGreenBright(
      `Installing the PostHog MCP server ${options.local && '(local)'}`,
    ),
  );

  await addMCPServerToClientsStep({
    cloudRegion: options.region,
    askPermission: false,
    local: options.local,
  });

  clack.log.message(
    `${chalk.greenBright(
      'You might need to restart your MCP clients to see the changes.',
    )}`,
  );

  clack.log.message(`Get started with some prompts like:
- What feature flags do I have active?
- Add a new feature flag for our homepage redesign
- What are my most common errors?`);

  clack.log.message(`Check out our MCP Server documentation:
${chalk.blueBright(`https://posthog.com/docs/model-context-protocol`)}`);
};

export const runMCPRemove = async (options?: { local?: boolean }) => {
  clack.intro(chalk.bgRed('Removing the PostHog MCP server'));
  const results = await removeMCPServerFromClientsStep({
    local: options?.local,
  });

  if (results.length === 0) {
    clack.outro(`No PostHog MCP servers found to remove.`);
    return;
  }

  clack.log.success(`PostHog MCP server removed from:`);
  results.map((c) => clack.log.message(`- ${c}`));
  clack.outro(
    `${chalk.green(
      'You might need to restart your MCP clients to see the changes.\n\n',
    )}`,
  );
};
