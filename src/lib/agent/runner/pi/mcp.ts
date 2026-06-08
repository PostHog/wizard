import type { MCPServerStreamableHttp } from '@openai/agents';
import type { HttpMcpDescriptor } from '../shared/mcp';

/**
 * Live MCP hosting for the `pi` runner.
 *
 * Unlike the AI SDK, the OpenAI Agents SDK ships first-class MCP support, so the
 * neutral HTTP descriptors map directly onto `MCPServerStreamableHttp` and the
 * Agent hosts them through `mcpServers`. The PostHog MCP the agent relies on is
 * therefore live on this runner.
 */

/** Options for `new MCPServerStreamableHttp(...)`. */
export interface StreamableHttpOptions {
  url: string;
  name: string;
  /** Headers (auth, user-agent) are sent through the transport's requestInit. */
  requestInit: { headers: Record<string, string> };
}

/** Project a neutral descriptor onto the SDK's streamable-HTTP server options. */
export function descriptorToStreamableHttpOptions(
  descriptor: HttpMcpDescriptor,
): StreamableHttpOptions {
  return {
    url: descriptor.url,
    name: descriptor.name,
    requestInit: { headers: descriptor.headers },
  };
}

/**
 * Construct and connect the MCP servers for a run. The SDK is ESM-only, so it's
 * imported dynamically. Each server is connected before the agent runs;
 * {@link closePiMcpServers} closes them afterward.
 */
export async function createPiMcpServers(
  descriptors: HttpMcpDescriptor[],
): Promise<MCPServerStreamableHttp[]> {
  if (descriptors.length === 0) return [];
  const { MCPServerStreamableHttp } = await import('@openai/agents');
  const servers = descriptors.map(
    (d) => new MCPServerStreamableHttp(descriptorToStreamableHttpOptions(d)),
  );
  await Promise.all(servers.map((s) => s.connect()));
  return servers;
}

/** Close MCP servers, swallowing per-server errors so teardown never throws. */
export async function closePiMcpServers(
  servers: MCPServerStreamableHttp[],
): Promise<void> {
  await Promise.all(
    servers.map((s) =>
      s.close().catch(() => {
        // best-effort teardown
      }),
    ),
  );
}
