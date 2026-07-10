/**
 * Wire the real PostHog MCP into the pi backend (#10). pi has no built-in MCP,
 * but `pi-mcp-adapter` is pi's own MCP extension — we load it the way pi itself
 * does, with `jiti` (pi's runtime `.ts` loader, already a transitive dep). The
 * adapter connects to the same hosted MCP the anthropic path uses (`boot.mcpUrl`).
 *
 * In CLI mode the server exposes a single `exec` tool that carries the whole
 * command protocol on its schema. We pre-warm the adapter's metadata cache by
 * connecting once and register the roster as DIRECT tools — so the agent calls
 * `exec` in one step instead of through the fragile `mcp` proxy search.
 *
 * The bearer token is passed by env-var NAME (`bearerTokenEnv`), so it lives only
 * in the wizard process for the adapter's in-process client. It is never written
 * to disk and never reaches pi's (env-scrubbed) tool subprocesses.
 */

import fs from 'fs';
import path from 'path';
import { createJiti } from 'jiti';
import { logToFile } from '@utils/debug';

const MCP_TOKEN_ENV = 'POSTHOG_MCP_TOKEN';

export interface PostHogMcpSetup {
  /** pi ExtensionFactory to add to the resource loader's `extensionFactories`. */
  extensionFactory: (pi: unknown) => void;
  /** Restore prior config + drop the token env var. Call after the run. */
  cleanup: () => void;
  /**
   * The MCP server's `instructions` payload, captured at warm-connect. The
   * adapter drops it, so the caller rides it into the system prompt — it carries
   * the "prioritize skills over tools" steer, the active project/environment, and
   * the tool domains the agent searches to discover tools. Undefined if the
   * warm-connect failed.
   */
  instructions?: string;
}

export async function setupPostHogMcp(opts: {
  agentDir: string;
  mcpUrl: string;
  accessToken: string;
  userAgent: string;
}): Promise<PostHogMcpSetup> {
  const { agentDir, mcpUrl, accessToken, userAgent } = opts;

  process.env[MCP_TOKEN_ENV] = accessToken;

  // The adapter discovers servers from <agentDir>/mcp.json. Merge our server in
  // and restore the prior file on cleanup so a user's own config is never lost.
  const configPath = path.join(agentDir, 'mcp.json');
  const previous = fs.existsSync(configPath)
    ? fs.readFileSync(configPath, 'utf8')
    : null;

  let config: { mcpServers: Record<string, Record<string, unknown>> } = {
    mcpServers: {},
  };
  if (previous) {
    try {
      config = JSON.parse(previous);
      config.mcpServers ??= {};
    } catch {
      config = { mcpServers: {} };
    }
  }
  const server: Record<string, unknown> = {
    url: mcpUrl,
    auth: 'bearer',
    bearerTokenEnv: MCP_TOKEN_ENV,
    headers: { 'User-Agent': userAgent },
    lifecycle: 'lazy',
    // Register only `exec`: `directTools: true` also mints a `posthog_get_<name>` tool per MCP resource, whose sentence-length names overflow Anthropic's 128-char tool-name limit and 400 the whole request.
    directTools: ['exec'],
    exposeResources: false,
  };
  config.mcpServers.posthog = server;
  // Disable the proxy `mcp` tool (its search indirection pollutes context); the adapter re-enables it only if no direct tools resolve.
  const settings = (config as { settings?: Record<string, unknown> }).settings;
  (config as { settings?: Record<string, unknown> }).settings = {
    ...settings,
    disableProxyTool: true,
    toolPrefix: 'posthog',
  };

  const writeConfig = (): void => {
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  };
  writeConfig();

  const jiti = createJiti(import.meta.url);

  // The server `instructions` (adapter drops them), captured below for the system prompt.
  let instructions: string | undefined;

  // Pre-warm: connect once to seed the adapter's metadata cache; best-effort (proxy fallback on failure).
  try {
    const sm = await jiti.import('pi-mcp-adapter/server-manager.ts');
    const mc = await jiti.import('pi-mcp-adapter/metadata-cache.ts');
    const manager = new sm.McpServerManager();
    try {
      const conn = await manager.connect('posthog', server);
      if (conn.status === 'connected' && conn.tools.length > 0) {
        mc.saveMetadataCache({
          version: 1,
          servers: {
            posthog: {
              configHash: mc.computeServerHash(server),
              tools: mc.serializeTools(conn.tools),
              resources: mc.serializeResources(conn.resources ?? []),
              cachedAt: Date.now(),
            },
          },
        });
        // The adapter drops the server `instructions` (skill steer + env + tool domains), so read them off the SDK client.
        const client = (conn as { client?: { getInstructions?: () => string } })
          .client;
        instructions = client?.getInstructions?.() || undefined;
        // Log the exec description length so adapter truncation of the protocol is detectable.
        const execTool = conn.tools.find((t: { name: string }) =>
          /(^|_)exec$/.test(t.name),
        ) as { description?: string } | undefined;
        const execDescLen = execTool?.description?.length ?? 0;
        logToFile(
          `[pi-mcp] warmed: ${conn.tools.length} tools, all direct; ` +
            `exec description ${execDescLen} chars; ` +
            `instructions ${instructions?.length ?? 0} chars`,
        );
      }
    } finally {
      await manager.closeAll().catch(() => undefined);
    }
  } catch (err) {
    logToFile(`[pi-mcp] cache warm skipped (proxy fallback): ${String(err)}`);
  }

  const mod = await jiti.import('pi-mcp-adapter/index.ts');
  const extensionFactory = ((mod as { default?: unknown }).default ?? mod) as (
    pi: unknown,
  ) => void;
  logToFile(`[pi-mcp] adapter loaded; posthog MCP at ${mcpUrl}`);

  const cleanup = (): void => {
    try {
      if (previous != null) fs.writeFileSync(configPath, previous, 'utf8');
      else fs.rmSync(configPath, { force: true });
    } catch (err) {
      logToFile(`[pi-mcp] config cleanup skipped: ${String(err)}`);
    }
    delete process.env[MCP_TOKEN_ENV];
  };

  return { extensionFactory, cleanup, instructions };
}
