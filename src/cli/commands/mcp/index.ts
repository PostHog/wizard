import { mcpAddCommand } from '../../../commands/mcp/add';
import { mcpRemoveCommand } from '../../../commands/mcp/remove';
import { mcpTutorialCommand } from './tutorial';
import type { Command } from '../command';

export const mcpCommand: Command = {
  name: 'mcp',
  description: 'MCP server management commands',
  children: [mcpAddCommand, mcpRemoveCommand, mcpTutorialCommand],
};
