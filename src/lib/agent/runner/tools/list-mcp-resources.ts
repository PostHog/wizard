import { ok, type ToolDefinition } from './types';

/**
 * Lists resources exposed by the in-process MCP servers.
 *
 * PR 04 builds the in-process MCP registry; until then this returns an empty
 * list so the tool is advertised and callable without error (the SDK path
 * exposes it by name, so the harness keeps parity by offering it too).
 */
export const listMcpResourcesTool: ToolDefinition = {
  name: 'ListMcpResourcesTool',
  description:
    'List resources available from connected MCP servers. Returns an empty list until the in-process MCP registry lands (PR 04).',
  inputSchema: {
    type: 'object',
    properties: {
      server: {
        type: 'string',
        description: 'Optional MCP server name to filter by',
      },
    },
  },
  handler() {
    return Promise.resolve(ok('[]'));
  },
};
