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
    // CLI mode's roster is a single `exec` tool, so register everything the
    // server exposes as direct tools — no curation needed.
    directTools: true,
  };
  config.mcpServers.posthog = server;
  // No proxy `mcp` tool: the proxy's search indirection both pollutes context
  // and makes the agent fumble. The single `exec` tool is registered directly.
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

  // Pre-warm: connect once and seed the adapter's metadata cache so the first
  // real call doesn't pay connect latency. Best-effort — if it fails the run
  // still gets the `mcp` proxy as a fallback.
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
        // The exec tool's description carries the whole command protocol; log
        // its length so adapter truncation of the schema is detectable.
        const execTool = conn.tools.find((t: { name: string }) =>
          /(^|_)exec$/.test(t.name),
        ) as { description?: string } | undefined;
        const execDescLen = execTool?.description?.length ?? 0;
        logToFile(
          `[pi-mcp] warmed: ${conn.tools.length} tools, all direct; ` +
            `exec description ${execDescLen} chars`,
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
