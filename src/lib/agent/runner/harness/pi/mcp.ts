/**
 * pi has no built-in MCP; `pi-mcp-adapter` — pi's own MCP extension, built here
 * with its supported `createMcpAdapter` embedding API — bridges the same hosted
 * MCP the anthropic path uses into the agent.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createJiti } from 'jiti';
import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
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

/**
 * `posthog_exec` as a native pi tool for orchestrator tasks, speaking to the
 * PostHog MCP through the same SDK client `fetchInstructions` uses.
 *
 * The adapter cannot surface this tool in a task session: it registers direct
 * tools from its on-disk metadata cache at factory time, and the cache is keyed
 * on the bearer token (`computeServerHash`), which is fresh every run — so the
 * cache never validates, only the proxy `mcp` tool registers, and a task that
 * was granted `posthog_exec` finds nothing by that name. Registering the tool
 * natively puts its availability in our hands instead of a cache's.
 *
 * Connects lazily on first call; one client serves the whole task session.
 */
export function createPostHogExecTool(opts: {
  mcpUrl: string;
  accessToken: string;
  userAgent: string;
}): { tool: ToolDefinition; cleanup: () => Promise<void> } {
  const { mcpUrl, accessToken, userAgent } = opts;
  let connecting: Promise<Client> | undefined;

  const client = (): Promise<Client> => {
    connecting ??= (async () => {
      const c = new Client({ name: 'posthog-wizard', version: VERSION });
      const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
        requestInit: {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'User-Agent': userAgent,
          },
        },
      });
      await c.connect(transport);
      logToFile('[pi-mcp] posthog_exec connected');
      return c;
    })().catch((err: unknown) => {
      // A failed connect must not poison the memo — the next call retries.
      connecting = undefined;
      throw err;
    });
    return connecting;
  };

  const tool = defineTool({
    name: 'posthog_exec',
    label: 'PostHog',
    description:
      'Run a PostHog command. Pass a CLI-style string in `command`: `search <term>` to find a tool, `schema <tool>` to read its input, `call <tool> <json>` to run it.',
    promptSnippet:
      'posthog_exec(command) — search, inspect, and call PostHog tools',
    parameters: Type.Object({
      command: Type.String({
        description:
          'e.g. `search external-data-sources`, `schema external-data-sources-create`, `call external-data-sources-create {...}`',
      }),
    }),
    async execute(_id, args) {
      const result = (await (
        await client()
      ).callTool({
        name: 'exec',
        arguments: { command: args.command },
      })) as { content?: { type: string; text?: string }[]; isError?: boolean };
      const rendered = (result.content ?? [])
        .map((part) => (part.type === 'text' ? part.text ?? '' : ''))
        .join('\n')
        .trim();
      logToFile(
        `[pi-mcp] posthog_exec "${args.command.slice(0, 80)}" → ${
          rendered.length
        } chars${result.isError ? ' (error)' : ''}`,
      );
      return {
        content: [{ type: 'text' as const, text: rendered }],
        details: {},
        isError: result.isError,
      };
    },
  });

  return {
    tool: tool as ToolDefinition,
    cleanup: async () => {
      if (!connecting) return;
      await connecting.then(
        (c) => c.close().catch(() => undefined),
        () => undefined,
      );
      connecting = undefined;
    },
  };
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
