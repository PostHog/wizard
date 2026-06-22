/**
 * wizard-ci-mcp — a standalone stdio MCP server that holds ONE live WizardStore
 * and exposes it, so an external agent (Claude Code) drives a real wizard run
 * turn by turn: read_state → perform_action → … → run_agent → … → keep_skills,
 * rendering the screen whenever it wants. Unlike e2e-full-run (which drives
 * itself via the scripted profile), here the connected agent makes every choice.
 *
 *   APP_DIR=/tmp/app POSTHOG_KEY_FILE=/path/to/phx.txt PROJECT_ID=… \
 *     npx tsx scripts/wizard-ci-mcp.no-jest.ts          # speaks MCP on stdio
 *
 * Tools: read_state, perform_action, render_screen, run_agent.
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

async function main() {
  // The key can come inline or from a file path (keeps the secret out of the
  // MCP config the agent registers).
  const apiKey = (
    process.env.POSTHOG_PERSONAL_API_KEY ??
    (process.env.POSTHOG_KEY_FILE
      ? fs.readFileSync(process.env.POSTHOG_KEY_FILE, 'utf8')
      : '')
  ).trim();
  const appDir = process.env.APP_DIR ?? '';
  const projectId =
    process.env.PROJECT_ID ?? process.env.POSTHOG_WIZARD_PROJECT_ID ?? '';
  const region = process.env.POSTHOG_REGION ?? 'us';
  if (!apiKey)
    throw new Error('POSTHOG_PERSONAL_API_KEY or POSTHOG_KEY_FILE required');
  if (!appDir || !fs.existsSync(appDir))
    throw new Error(`APP_DIR missing or not found: ${appDir}`);

  const store = new WizardStore(Program.PostHogIntegration);
  setUI(new InkUI(store)); // real UI, never rendered → no stdout
  store.session = buildSession({
    installDir: appDir,
    ci: true, // OAuth-bypass + ai-opt-in auto-consent; phx key as gateway bearer
    apiKey,
    projectId,
    region,
  });
  await store.runReadyHooks(); // framework detection
  store.runInitHooks(); // health-check readiness probe
  const driver = new WizardCiDriver(store);

  /** Render the current screen to ANSI (access token redacted). */
  const renderNow = (): string => {
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
  };

  const server = new McpServer({ name: 'wizard-ci', version: '1.0.0' });

  server.tool(
    'read_state',
    "Read the wizard's committed state: current screen, run phase, a secret-free session view, agent tasks/status, any pending question, unresolved setup questions, and the actions legal right now. Call first and after every perform_action.",
    {},
    async () => text(driver.readState()),
  );

  server.tool(
    'perform_action',
    'Commit a decision: invoke a legal action for the current screen (e.g. confirm_setup, dismiss_outage, choose, set_mcp_outcome, dismiss_slack, keep_skills). Returns the next state. The action must appear in read_state.actions.',
    {
      action: z.string().describe('Action id from read_state.actions'),
      params: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Action params, e.g. { key: "router", value: "app" }'),
    },
    async ({ action, params }) => {
      try {
        return text(driver.performAction(action, params ?? {}));
      } catch (e) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${e instanceof Error ? e.message : String(e)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'render_screen',
    'Render the current TUI screen to ANSI so you can see exactly what the user would.',
    {},
    async () => text(renderNow()),
  );

  server.tool(
    'run_agent',
    "Run the real wizard integration agent — the `run` screen's work. Blocks until it finishes (minutes), then returns the final runPhase and next screen. Call when read_state shows currentScreen=run.",
    {},
    async () => {
      await store.getGate('intro');
      await store.getGate('health-check');
      await runAgent(posthogIntegrationConfig, store.session);
      return text({
        runPhase: store.session.runPhase,
        currentScreen: store.currentScreen,
      });
    },
  );

  process.stderr.write(
    `wizard-ci-mcp: serving on stdio (app=${appDir}, detected=${
      store.session.integration ?? '?'
    })\n`,
  );
  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  process.stderr.write(`wizard-ci-mcp fatal: ${e?.stack ?? e}\n`);
  process.exit(1);
});
