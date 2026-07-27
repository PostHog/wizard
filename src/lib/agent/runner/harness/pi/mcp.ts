/**
 * Wire the real PostHog MCP into the pi backend (#10). pi has no built-in MCP,
 * but `pi-mcp-adapter` is pi's own MCP extension — built with `createMcpAdapter`
 * (the adapter's supported embedding API): an in-memory, isolated config, so no
 * files are written and nothing needs restoring. The adapter connects to the
 * same hosted MCP the anthropic path uses (`boot.credentials.host.mcpUrl`).
 *
 * In CLI mode the server exposes a single `exec` tool that carries the whole
 * command protocol on its schema; it registers as a DIRECT tool (`lifecycle:
 * "eager"` connects at extension load) so the agent calls `exec` in one step
 * instead of through the fragile `mcp` proxy search.
 *
 * The bearer token is passed by env-var NAME (`bearerTokenEnv`), so it lives only
 * in the wizard process for the adapter's in-process client. It is never written
 * to disk and never reaches pi's (env-scrubbed) tool subprocesses.
 *
 * The adapter ships raw TypeScript, so it loads through `jiti` (pi's own runtime
 * `.ts` loader, already a dependency) — the README's documented requirement.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createJiti } from 'jiti';
import { logToFile } from '@utils/debug';

const MCP_TOKEN_ENV = 'POSTHOG_MCP_TOKEN';

export interface PostHogMcpSetup {
  /** pi ExtensionFactory to add to the resource loader's `extensionFactories`. */
  extensionFactory: (pi: unknown) => void;
  /** Drop the token env var. Call after the run. */
  cleanup: () => void;
  /**
   * The MCP server's `instructions` payload from the initialize handshake. The
   * caller rides it into the system prompt — it carries the "prioritize skills
   * over tools" steer, the active project/environment, and the tool domains the
   * agent searches to discover tools. Undefined if the fetch failed.
   */
  instructions?: string;
}

/** One standard-SDK handshake for the server `instructions`; best-effort. */
async function fetchInstructions(
  mcpUrl: string,
  accessToken: string,
  userAgent: string,
): Promise<string | undefined> {
  const client = new Client({ name: 'posthog-wizard', version: '1.0.0' });
  try {
    const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': userAgent,
        },
      },
    });
    await client.connect(transport);
    const instructions = client.getInstructions() || undefined;
    logToFile(`[pi-mcp] instructions ${instructions?.length ?? 0} chars`);
    return instructions;
  } catch (err) {
    logToFile(`[pi-mcp] instructions fetch skipped: ${String(err)}`);
    return undefined;
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function setupPostHogMcp(opts: {
  mcpUrl: string;
  accessToken: string;
  userAgent: string;
}): Promise<PostHogMcpSetup> {
  const { mcpUrl, accessToken, userAgent } = opts;

  process.env[MCP_TOKEN_ENV] = accessToken;

  const jiti = createJiti(import.meta.url);
  const mod = await jiti.import('pi-mcp-adapter');
  const extensionFactory = mod.createMcpAdapter({
    config: {
      mcpServers: {
        posthog: {
          url: mcpUrl,
          auth: 'bearer',
          bearerTokenEnv: MCP_TOKEN_ENV,
          headers: { 'User-Agent': userAgent },
          // Connect at extension load — direct tools register without a session_start.
          lifecycle: 'eager',
          // Register only `exec`: `directTools: true` also mints a `posthog_get_<name>` tool per MCP resource, whose sentence-length names overflow Anthropic's 128-char tool-name limit and 400 the whole request.
          directTools: ['exec'],
          exposeResources: false,
        },
      },
      // Disable the proxy `mcp` tool (its search indirection pollutes context); the adapter re-enables it only if no direct tools resolve.
      settings: { disableProxyTool: true, toolPrefix: 'posthog' },
    },
  });
  logToFile(`[pi-mcp] adapter loaded; posthog MCP at ${mcpUrl}`);

  const instructions = await fetchInstructions(mcpUrl, accessToken, userAgent);

  const cleanup = (): void => {
    delete process.env[MCP_TOKEN_ENV];
  };

  return { extensionFactory, cleanup, instructions };
}
