import { mcpAddCommand } from './add.js';
import { mcpRemoveCommand } from './remove.js';
import { mcpTutorialCommand } from './tutorial.js';
import type { Command } from '../command.js';

export const mcpCommand: Command = {
  name: 'mcp',
  description: 'MCP server management commands',
  children: [mcpAddCommand, mcpRemoveCommand, mcpTutorialCommand],
};
