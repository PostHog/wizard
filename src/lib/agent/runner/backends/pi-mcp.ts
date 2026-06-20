/**
 * Wire the real PostHog MCP into the pi backend (#10). pi has no built-in MCP,
 * but `pi-mcp-adapter` is pi's own MCP extension — we load it the way pi itself
 * does, with `jiti` (pi's runtime `.ts` loader, already a transitive dep). The
 * adapter connects to the same hosted MCP the anthropic path uses (`boot.mcpUrl`).
 *
 * To match the anthropic path (which has `dashboard-create` etc. as first-class
 * tools), we pre-warm the adapter's metadata cache by connecting once and then
 * register the dashboard/insight/query tools as DIRECT tools — so the agent
 * calls them in one step instead of through the fragile `mcp` proxy search.
 *
 * The bearer token is passed by env-var NAME (`bearerTokenEnv`), so it lives only
 * in the wizard process for the adapter's in-process client. It is never written
 * to disk and never reaches pi's (env-scrubbed) tool subprocesses.
 */

import fs from 'fs';
import path from 'path';
import { createJiti } from 'jiti';
import { logToFile } from '../../../../utils/debug';

const MCP_TOKEN_ENV = 'POSTHOG_MCP_TOKEN';
/**
 * Which PostHog MCP tools to surface as first-class tools. Only the few the
 * dashboard step needs — creating a dashboard and adding insights to it. The
 * broad `/dashboard|insight|query/` matched ~30 tools, which bloated context
 * (and tripped post-run compaction); the create/add verbs are enough.
 */
const DIRECT_TOOL_PATTERN =
  /(dashboard|insight)[-_]?(create)|(create)[-_]?(dashboard|insight)|add[-_]?insight|dashboard[-_]?add/i;

export interface PostHogMcpSetup {
  /** pi ExtensionFactory to add to the resource loader's `extensionFactories`. */
  extensionFactory: (pi: unknown) => void;
  /** Restore prior config + drop the token env var. Call after the run. */
  cleanup: () => void;
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
  };
  config.mcpServers.posthog = server;
  // No proxy `mcp` tool: the PostHog MCP exposes ~30 tools, and the proxy's
  // search indirection both pollutes context and makes the agent fumble. We
  // register only the curated dashboard/insight tools as direct tools below.
  // (If the warm-connect fails and no direct tools resolve, the adapter
  // re-enables the proxy automatically as a fallback.)
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

  // Pre-warm: connect once, pick the data tools, register them as direct tools.
  // Best-effort — if it fails the run still gets the `mcp` proxy as a fallback.
  try {
    const sm = await jiti.import('pi-mcp-adapter/server-manager.ts');
    const mc = await jiti.import('pi-mcp-adapter/metadata-cache.ts');
    const manager = new sm.McpServerManager();
    try {
      const conn = await manager.connect('posthog', server);
      if (conn.status === 'connected' && conn.tools.length > 0) {
        const direct = conn.tools
          .map((t) => t.name)
          .filter((n) => DIRECT_TOOL_PATTERN.test(n));
        server.directTools = direct.length > 0 ? direct : true;
        writeConfig();
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
        logToFile(
          `[pi-mcp] warmed: ${conn.tools.length} tools, ${
            Array.isArray(server.directTools)
              ? server.directTools.length
              : 'all'
          } direct`,
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

  return { extensionFactory, cleanup };
}
