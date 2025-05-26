import chalk from 'chalk';
import {
  addMCPServerToClientsStep,
  removeMCPServerFromClientsStep,
} from './steps/add-mcp-server-to-clients';
import clack from './utils/clack';
import {
  abort,
  askForCloudRegion,
  getOrAskForProjectData,
} from './utils/clack-utils';
import type { CloudRegion } from './utils/types';

export const runMCPInstall = async (options: {
  signup: boolean;
  region?: CloudRegion;
}) => {
  clack.intro('Installing the PostHog MCP server.');

  const cloudRegion = options.region ?? (await askForCloudRegion());

  const { personalApiKey } = await getOrAskForProjectData({
    signup: options.signup,
    cloudRegion,
  });

  if (!personalApiKey) {
    await abort('Unable to create a personal API key.');
  }

  await addMCPServerToClientsStep(personalApiKey as string, {});

  clack.outro(`PostHog MCP server added successfully.

${chalk.cyan('You might need to restart your MCP clients to see the changes.')}

Get started with some prompts like:

  - What feature flags do I have active?
  - Add a new feature flag for our homepage redesign
  - What are my most common errors?
`);
};

export const runMCPRemove = async () => {
  const results = await removeMCPServerFromClientsStep({});

  if (results.length === 0) {
    clack.outro(`No PostHog MCP servers found to remove.`);
    return;
  }

  clack.outro(`PostHog MCP server removed from:
  ${results.map((c) => `- ${c}`).join('\n  ')}
  
  ${chalk.cyan(
    'You might need to restart your MCP clients to see the changes.',
  )}`);
};
