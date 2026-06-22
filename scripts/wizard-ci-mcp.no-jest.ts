/**
 * wizard-ci-mcp — a stdio MCP server that holds one live WizardStore and exposes
 * it as tools, so an agent drives a real wizard run turn by turn: open_app →
 * read_state → perform_action → … → run_agent → … → keep_skills, rendering the
 * screen whenever it wants.
 *
 * Registered in this repo's `.mcp.json`, so the tools are bound in every session
 * here — no per-run setup. It boots app-agnostic; `open_app` picks the app +
 * credentials at call time (so nothing secret lives in `.mcp.json`). It also
 * auto-opens from APP_DIR / POSTHOG_KEY_FILE env if those happen to be set.
 *
 * stdout is the JSON-RPC channel — diagnostics go to stderr only.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import { WizardStore } from '@ui/tui/store';
import { InkUI } from '@ui/tui/ink-ui';
import { setUI } from '@ui/index';
import { buildSession, type WizardSession } from '@lib/wizard-session';
import { Program } from '@lib/programs/program-registry';
import { posthogIntegrationConfig } from '@lib/programs/posthog-integration';
import { runAgent } from '@lib/agent/agent-runner';
import { WizardCiDriver } from '@e2e-harness/wizard-ci-driver';
import { renderFrame } from '@e2e-harness/replay';
import type { RecordedFrame } from '@e2e-harness/recorder';

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

/** Render a store's current screen to ANSI (access token redacted). */
function renderNow(store: WizardStore): string {
  const s = store.session;
  const session: WizardSession = s.credentials
    ? {
        ...s,
        credentials: { ...s.credentials, accessToken: 'phx_***redacted***' },
      }
    : s;
  const frame: RecordedFrame = {
    seq: 0,
    ms: 0,
    triggers: ['screen'],
    screen: store.currentScreen,
    hasOverlay: store.router.hasOverlay,
    session,
    tasks: store.tasks.map((t) => ({
      label: t.label,
      status: t.status,
      activeForm: t.activeForm,
      done: t.done,
    })),
    statusMessages: [...store.statusMessages],
    eventPlan: store.eventPlan.map((e) => ({
      name: e.name,
      description: e.description,
    })),
  };
  return renderFrame(frame, Program.PostHogIntegration);
}

type Live = { store: WizardStore; driver: WizardCiDriver };
let active: Live | null = null;

/** Boot a fresh live wizard on an app and make it the active run. */
async function openApp(cfg: {
  appDir: string;
  apiKey: string;
  projectId: string;
  region: string;
}): Promise<Live> {
  if (!cfg.appDir || !fs.existsSync(cfg.appDir))
    throw new Error(`appDir missing or not found: ${cfg.appDir}`);
  if (!cfg.apiKey)
    throw new Error('a PostHog key is required (keyFile or apiKey)');
  const store = new WizardStore(Program.PostHogIntegration);
  setUI(new InkUI(store)); // real UI, never rendered → no stdout
  store.session = buildSession({
    installDir: cfg.appDir,
    ci: true, // OAuth-bypass + ai-opt-in auto-consent; phx key as gateway bearer
    apiKey: cfg.apiKey,
    projectId: cfg.projectId,
    region: cfg.region,
  });
  await store.runReadyHooks(); // framework detection
  store.runInitHooks(); // health-check readiness probe
  active = { store, driver: new WizardCiDriver(store) };
  return active;
}

/** The active run, auto-opening from env if it was provided at launch. */
async function ensure(): Promise<Live> {
  if (active) return active;
  const envKey = (
    process.env.POSTHOG_PERSONAL_API_KEY ??
    (process.env.POSTHOG_KEY_FILE
      ? fs.readFileSync(process.env.POSTHOG_KEY_FILE, 'utf8')
      : '')
  ).trim();
  if (process.env.APP_DIR && envKey)
    return openApp({
      appDir: process.env.APP_DIR,
      apiKey: envKey,
      projectId:
        process.env.PROJECT_ID ?? process.env.POSTHOG_WIZARD_PROJECT_ID ?? '',
      region: process.env.POSTHOG_REGION ?? 'us',
    });
  throw new Error(
    'No app open. Call open_app({ appDir, keyFile, projectId, region }) first.',
  );
}

async function main() {
  const server = new McpServer({ name: 'wizard-ci', version: '1.0.0' });

  server.tool(
    'open_app',
    'Boot a live wizard run on an app and make it active. Call once before the other tools. appDir is a throwaway copy of the app to integrate. Returns the first screen.',
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
        const key = (
          apiKey ?? (keyFile ? fs.readFileSync(keyFile, 'utf8') : '')
        ).trim();
        const live = await openApp({
          appDir,
          apiKey: key,
          projectId,
          region: region ?? 'us',
        });
        return text(live.driver.readState());
      } catch (e) {
        return errorOut(e);
      }
    },
  );

  server.tool(
    'read_state',
    "Read the wizard's committed state: current screen, run phase, a secret-free session view, agent tasks/status, any pending question, unresolved setup questions, and the actions legal right now. Call after every perform_action.",
    {},
    async () => {
      try {
        return text((await ensure()).driver.readState());
      } catch (e) {
        return errorOut(e);
      }
    },
  );

  server.tool(
    'perform_action',
    'Commit a decision: invoke a legal action for the current screen (e.g. confirm_setup, dismiss_outage, choose, set_mcp_outcome, dismiss_slack, keep_skills). Returns the next state. The action must appear in read_state.actions.',
    {
      action: z.string().describe('Action id from read_state.actions'),
      params: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Action params, e.g. { key: "router", value: "app-router" }'),
    },
    async ({ action, params }) => {
      try {
        return text(
          (await ensure()).driver.performAction(action, params ?? {}),
        );
      } catch (e) {
        return errorOut(e);
      }
    },
  );

  server.tool(
    'render_screen',
    'Render the current TUI screen to ANSI so you can see exactly what the user would.',
    {},
    async () => {
      try {
        return text(renderNow((await ensure()).store));
      } catch (e) {
        return errorOut(e);
      }
    },
  );

  server.tool(
    'run_agent',
    "Run the real wizard integration agent — the `run` screen's work. Blocks until it finishes (minutes), then returns the final runPhase and next screen. Call when read_state shows currentScreen=run.",
    {},
    async () => {
      try {
        const { store } = await ensure();
        await store.getGate('intro');
        await store.getGate('health-check');
        await runAgent(posthogIntegrationConfig, store.session);
        return text({
          runPhase: store.session.runPhase,
          currentScreen: store.currentScreen,
        });
      } catch (e) {
        return errorOut(e);
      }
    },
  );

  await server.connect(new StdioServerTransport());
  process.stderr.write('wizard-ci-mcp: ready on stdio\n');
}

main().catch((e) => {
  process.stderr.write(`wizard-ci-mcp fatal: ${e?.stack ?? e}\n`);
  process.exit(1);
});
