import { WIZARD_USER_AGENT } from '../../../constants';

/**
 * Neutral MCP descriptors for the model-agnostic runners.
 *
 * `initializeAgent` builds an SDK-shaped `mcpServers` map for the Anthropic
 * path: HTTP servers (`posthog-wizard` + any additional) as
 * `{ type: 'http', url, headers }`, plus the in-process `wizard-tools` server
 * as a live SDK `McpServer` instance. The `pi` and `vercel` runners can't
 * consume the SDK's map directly, so this module projects the HTTP servers
 * into a framework-neutral descriptor each runner hosts through its own SDK's
 * MCP facility (OpenAI Agents' `MCPServerStreamableHttp`, etc.).
 *
 * The in-process `wizard-tools` server is intentionally not projected here: it
 * is a live SDK object, not an HTTP endpoint, so exposing its tools to the
 * neutral runners means re-emitting them as neutral `ToolDefinition`s — tracked
 * separately. This module covers the HTTP servers, which include the PostHog
 * MCP the agent relies on.
 */

/** A streamable-HTTP MCP server, in the runner-neutral shape. */
export interface HttpMcpDescriptor {
  /** Server name (e.g. `posthog-wizard`). */
  name: string;
  /** Streamable-HTTP endpoint URL. */
  url: string;
  /** Headers to send on connect (auth, user-agent). */
  headers: Record<string, string>;
}

/** An entry in the SDK-shaped `mcpServers` map that targets an HTTP endpoint. */
interface HttpServerEntry {
  type?: string;
  url?: unknown;
  headers?: unknown;
}

/** True when the entry is an HTTP(S) MCP server with a usable URL. */
function isHttpEntry(
  value: unknown,
): value is HttpServerEntry & { url: string } {
  if (!value || typeof value !== 'object') return false;
  const entry = value as HttpServerEntry;
  // initializeAgent tags HTTP servers with `type: 'http'`; the in-process
  // wizard-tools server is a live SDK object with no `type`/`url`, so it's
  // skipped here.
  return entry.type === 'http' && typeof entry.url === 'string';
}

/**
 * Project the SDK-shaped `mcpServers` map into neutral HTTP descriptors,
 * preserving any per-server headers the SDK path set (e.g. the PostHog bearer
 * token on `posthog-wizard`). A default `User-Agent` is added when absent so
 * the gateway attributes requests to the wizard, matching the SDK path.
 */
export function extractHttpMcpDescriptors(
  mcpServers: Record<string, unknown> | undefined,
): HttpMcpDescriptor[] {
  if (!mcpServers) return [];
  const descriptors: HttpMcpDescriptor[] = [];
  for (const [name, entry] of Object.entries(mcpServers)) {
    if (!isHttpEntry(entry)) continue;
    const headers: Record<string, string> = {};
    if (entry.headers && typeof entry.headers === 'object') {
      for (const [key, value] of Object.entries(
        entry.headers as Record<string, unknown>,
      )) {
        if (typeof value === 'string') headers[key] = value;
      }
    }
    if (!('User-Agent' in headers)) headers['User-Agent'] = WIZARD_USER_AGENT;
    descriptors.push({ name, url: entry.url, headers });
  }
  return descriptors;
}
