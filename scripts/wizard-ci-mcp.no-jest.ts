/**
 * wizard-ci-mcp — MCP server that lets an agent drive the REAL wizard TUI.
 *
 * A thin proxy: it spawns the shared real-TUI host (scripts/tui-host.no-jest.ts,
 * MODE=serve) in a PTY via the Node capturer, forwards read_state/perform_action/
 * run_agent to it over a unix socket, and returns the REAL rendered screen for
 * render_screen. No store or rendering lives here — same host the CI snapshot
 * route uses. stdout is the JSON-RPC channel; nothing else writes to it.
 *
 * Registered in this repo's `.mcp.json`, so the tools are bound in every session.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  startServeHost,
  waitFor,
  type ServeHost,
} from '@e2e-harness/serve-host';

const text = (data: unknown) => ({
  content: [
    {
      type: 'text' as const,
      text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
    },
  ],
});
const errorOut = (e: unknown) => ({
  content: [
    {
      type: 'text' as const,
      text: `Error: ${e instanceof Error ? e.message : String(e)}`,
    },
  ],
  isError: true,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let host: ServeHost | null = null;

function rpc(req: object) {
  if (!host)
    return Promise.reject(new Error('No app open. Call open_app first.'));
  return host.rpc(req);
}

async function main() {
  const server = new McpServer({ name: 'wizard-ci', version: '1.0.0' });

  server.tool(
    'open_app',
    'Boot the real wizard TUI on an app and make it active. Call once before the other tools. appDir is a throwaway copy of the app to integrate. Returns the first screen.',
    {
      appDir: z
        .string()
        .describe('Absolute path to the app (a throwaway /tmp copy)'),
      keyFile: z
        .string()
        .optional()
        .describe(
          'Absolute path to a file holding the PostHog phx key (preferred)',
        ),
      apiKey: z
        .string()
        .optional()
        .describe('The phx key inline (prefer keyFile to keep it out of logs)'),
      projectId: z.string().describe('PostHog project id the key is scoped to'),
      region: z
        .enum(['us', 'eu'])
        .optional()
        .describe('PostHog region (default us)'),
    },
    async ({ appDir, keyFile, apiKey, projectId, region }) => {
      try {
        if (host) host.dispose();
        host = startServeHost({ appDir, projectId, region, keyFile, apiKey });
        if (!(await host.waitForSocketOrExit(30_000)))
          return errorOut(new Error('the TUI host did not start'));
        const { capture } = host;
        await waitFor(() => capture.frame().includes('PostHog'), 30_000);
        const r = await rpc({ type: 'read_state' });
        return text(r.state ?? r);
      } catch (e) {
        return errorOut(e);
      }
    },
  );

  server.tool(
    'read_state',
    "Read the wizard's committed state: current screen, run phase, a secret-free session view, tasks, pending question, and the actions legal now. Call after every perform_action and to poll run_agent (integration: running → done).",
    {},
    async () => {
      try {
        const r = await rpc({ type: 'read_state' });
        return text(r.state ?? r);
      } catch (e) {
        return errorOut(e);
      }
    },
  );

  server.tool(
    'perform_action',
    'Commit a decision on the current screen (confirm_setup, dismiss_outage, choose, set_mcp_outcome, dismiss_slack). The action must appear in read_state.actions. Returns the next state.',
    {
      action: z.string().describe('Action id from read_state.actions'),
      params: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Action params, e.g. { key: "router", value: "app-router" }'),
    },
    async ({ action, params }) => {
      try {
        const r = await rpc({
          type: 'perform_action',
          action,
          params: params ?? {},
        });
        return text(r.state ?? r);
      } catch (e) {
        return errorOut(e);
      }
    },
  );

  server.tool(
    'render_screen',
    'Return the REAL rendered TUI screen (ANSI-stripped text) — exactly what the user would see.',
    {},
    async () => {
      try {
        if (!host) throw new Error('No app open. Call open_app first.');
        await sleep(150); // let the emulator apply the latest frame
        return text(host.capture.frame());
      } catch (e) {
        return errorOut(e);
      }
    },
  );

  server.tool(
    'run_agent',
    'Kick off the real integration in the background and return immediately. It advances the auth and run screens (they never advance on their own). Then poll read_state — integration goes running → done and currentScreen advances to outro, or → failed with the reason in integrationError. Creates real PostHog resources (a dashboard + insights). Call once setup is confirmed.',
    {},
    async () => {
      try {
        const r = await rpc({ type: 'run_agent' });
        return text({
          status:
            'integration started in the background — poll read_state (integration: running → done; screen advances to outro)',
          ...r,
        });
      } catch (e) {
        return errorOut(e);
      }
    },
  );

  await server.connect(new StdioServerTransport());
  process.stderr.write('wizard-ci-mcp: proxy ready on stdio\n');
}

main().catch((e) => {
  process.stderr.write(`wizard-ci-mcp fatal: ${e?.stack ?? e}\n`);
  process.exit(1);
});
