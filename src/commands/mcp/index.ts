import { mcpAddCommand } from './add';
import { mcpRemoveCommand } from './remove';
import type { Command } from '../command';

export const mcpCommand: Command = {
  name: 'mcp',
  description: 'MCP server management commands',
  children: [mcpAddCommand, mcpRemoveCommand],
};
