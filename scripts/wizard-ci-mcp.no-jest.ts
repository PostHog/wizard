/**
 * wizard-ci-mcp: an MCP server that lets an agent drive the real wizard TUI.
 *
 * A thin proxy. `open_app` spawns the real wizard (`--ci --control-socket`) in
 * a PTY, then read_state / perform_action / run_agent go to the wizard's
 * control API over its unix socket and render_screen returns the real rendered
 * frame. stdout is the JSON-RPC channel; nothing else writes to it.
 *
 * Registered in this repo's `.mcp.json`, so the tools are bound in every session.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { RunPhase } from '@store';
import { ControlClient } from '@store/control';
import { Program } from '@store/programs';
import type { ControlState, ProgramId } from '@store/types';
import { captureTui, type TuiCapture } from '@e2e-harness/tui-capture';
import { buildLaunch, waitForSocket } from '@e2e-harness/launch';

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

let cap: TuiCapture | null = null;
let client: ControlClient | null = null;

function active(): ControlClient {
  if (!client) throw new Error('No app open. Call open_app first.');
  return client;
}

const RUN_STATUS: Record<RunPhase, string> = {
  [RunPhase.Idle]: 'idle',
  [RunPhase.Running]: 'running',
  [RunPhase.Completed]: 'done',
  [RunPhase.Error]: 'failed',
};

/** read_state adds the background run status under its historical names. */
function withRunStatus(state: ControlState): Record<string, unknown> {
  const { runPhase, runRequested, outroData } = state.session;
  const armed = runPhase === RunPhase.Idle && runRequested;
  return {
    ...state,
    integration: armed ? 'running' : RUN_STATUS[runPhase],
    integrationError:
      runPhase === RunPhase.Error ? outroData?.message ?? null : null,
  };
}

async function waitFor(cond: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await sleep(150);
  }
  return false;
}

async function main() {
  const server = new McpServer({ name: 'wizard-ci', version: '2.0.0' });

  server.tool(
    'open_app',
    'Boot the real wizard TUI on an app and make it active. Call once before the other tools. appDir is a throwaway copy of the app to integrate. Returns the first state.',
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
        if (cap) cap.kill();
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-ci-'));
        const socketPath = path.join(dir, 'w.sock');
        const key = (
          keyFile ? fs.readFileSync(keyFile, 'utf8') : apiKey ?? ''
        ).trim();
        const launch = buildLaunch({
          programId:
            (process.env.PROGRAM as ProgramId) || Program.PostHogIntegration,
          appDir,
          socketPath,
          projectId,
          region: region ?? 'us',
          apiKey: key || undefined,
          e2eAsk: process.env.E2E_ASK === 'true',
          harness: process.env.SNAP_HARNESS || undefined,
          sequence: process.env.SNAP_SEQUENCE || undefined,
          model: process.env.SNAP_MODEL || undefined,
        });
        cap = captureTui({ ...launch, cwd: process.cwd() });
        await waitForSocket(socketPath, 60_000);
        client = new ControlClient(socketPath);
        await waitFor(() => cap!.frame().includes('PostHog'), 30_000);
        return text(withRunStatus(await client.state()));
      } catch (e) {
        return errorOut(e);
      }
    },
  );

  server.tool(
    'read_state',
    "Read the wizard's committed state: current screen, run phase, a secret-free session view, tasks, pending question, and the actions legal now. Call after every perform_action and to poll run_agent (integration: running -> done).",
    {},
    async () => {
      try {
        return text(withRunStatus(await active().state()));
      } catch (e) {
        return errorOut(e);
      }
    },
  );

  server.tool(
    'perform_action',
    'Commit a decision on the current screen (confirm_setup, dismiss_outage, choose, set_mcp_outcome, dismiss_slack, keep_skills). The action must appear in read_state.actions. Returns the next state.',
    {
      action: z.string().describe('Action id from read_state.actions'),
      params: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Action params, e.g. { key: "router", value: "app-router" }'),
    },
    async ({ action, params }) => {
      try {
        return text(await active().performAction(action, params ?? {}));
      } catch (e) {
        return errorOut(e);
      }
    },
  );

  server.tool(
    'render_screen',
    'Return the REAL rendered TUI screen (ANSI-stripped text), exactly what the user would see.',
    {},
    async () => {
      try {
        if (!cap) throw new Error('No app open. Call open_app first.');
        await sleep(150); // let the emulator apply the latest frame
        return text(cap.frame());
      } catch (e) {
        return errorOut(e);
      }
    },
  );

  server.tool(
    'run_agent',
    'Release the real program run in the background and return immediately. The runner then advances the auth and run screens (they never advance on their own). Poll read_state: integration goes running -> done and currentScreen advances to outro, or -> failed with the reason in integrationError. Creates real PostHog resources (a dashboard + insights). Call once setup is confirmed.',
    {},
    async () => {
      try {
        const state = await active().armRun();
        return text({
          status:
            'integration started in the background; poll read_state (integration: running -> done; screen advances to outro)',
          ok: true,
          runRequested: state.session.runRequested,
        });
      } catch (e) {
        return errorOut(e);
      }
    },
  );

  await server.connect(new StdioServerTransport());
  process.stderr.write('wizard-ci-mcp: proxy ready on stdio\n');
}

main().catch((e: unknown) => {
  process.stderr.write(
    `wizard-ci-mcp fatal: ${(e as Error)?.stack ?? String(e)}\n`,
  );
  process.exit(1);
});
