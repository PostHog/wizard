import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import yaml from 'yaml';
import { WIZARD_USER_AGENT } from '../lib/constants';
import { runtimeEnv } from '../env';
import type { CloudRegion } from '../lib/wizard-session';

export function resolveMcpUrl(opts: {
  localMcp: boolean;
  region: CloudRegion | undefined;
}): string {
  if (opts.localMcp) return 'http://localhost:8787/mcp';
  const override = runtimeEnv('MCP_URL');
  if (override) return override;
  return opts.region === 'eu'
    ? 'https://mcp-eu.posthog.com/mcp'
    : 'https://mcp.posthog.com/mcp';
}

/**
 * Call a single MCP tool over the streamable-HTTP transport using the
 * official SDK. PostHog's MCP server returns tool results as YAML by
 * default, so the first text content block is YAML-parsed unless
 * `parseAs: 'json'` is set.
 */
export async function callMcpTool<T>(args: {
  mcpUrl: string;
  apiKey: string;
  toolName: string;
  arguments: Record<string, unknown>;
  parseAs?: 'yaml' | 'json';
}): Promise<T> {
  const transport = new StreamableHTTPClientTransport(new URL(args.mcpUrl), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        'User-Agent': WIZARD_USER_AGENT,
      },
    },
  });

  const client = new Client({ name: 'posthog-wizard', version: '0' });
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: args.toolName,
      arguments: args.arguments,
    });
    if ((result as { isError?: boolean }).isError) {
      const content = result.content as
        | Array<{ type: string; text?: string }>
        | undefined;
      const msg = content?.[0]?.text ?? 'unknown error';
      throw new Error(`MCP ${args.toolName}: ${msg}`);
    }
    const content = result.content as
      | Array<{ type: string; text?: string }>
      | undefined;
    const text = content?.[0]?.text;
    if (typeof text !== 'string') {
      throw new Error(`MCP ${args.toolName}: missing text content`);
    }
    return (args.parseAs === 'json' ? JSON.parse(text) : yaml.parse(text)) as T;
  } finally {
    await client.close().catch(() => undefined);
  }
}
