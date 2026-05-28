import { mcpAddCommand } from './add';
import { mcpRemoveCommand } from './remove';
import type { WizardCommand } from '../../wizard';

export const mcpCommand: WizardCommand = {
  name: 'mcp',
  description: 'MCP server management commands',
  children: [mcpAddCommand, mcpRemoveCommand],
};
