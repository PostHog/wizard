/**
 * pi has no built-in MCP; `pi-mcp-adapter` — pi's own MCP extension, built here
 * with its supported `createMcpAdapter` embedding API — bridges the same hosted
 * MCP the anthropic path uses into the agent.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createJiti } from 'jiti';
import { VERSION } from '@lib/version';
import { logToFile } from '@utils/debug';

const MCP_TOKEN_ENV = 'POSTHOG_MCP_TOKEN';

export interface PostHogMcpSetup {
  /** pi ExtensionFactory to add to the resource loader's `extensionFactories`. */
  extensionFactory: (pi: unknown) => void;
  /** Drop the token env var. Call after the run. */
  cleanup: () => void;
}

/** Server `instructions` for the system prompt — the adapter exposes no accessor, so one standard-SDK handshake; best-effort. */
export async function fetchInstructions(
  mcpUrl: string,
  accessToken: string,
  userAgent: string,
): Promise<string | undefined> {
  const client = new Client({ name: 'posthog-wizard', version: VERSION });
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

  // By env NAME: the token stays in this process, off disk, and never reaches pi's env-scrubbed tool subprocesses.
  process.env[MCP_TOKEN_ENV] = accessToken;

  // The adapter ships raw TypeScript; loading through jiti is its documented requirement.
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

  const cleanup = (): void => {
    delete process.env[MCP_TOKEN_ENV];
  };

  return { extensionFactory, cleanup };
}
