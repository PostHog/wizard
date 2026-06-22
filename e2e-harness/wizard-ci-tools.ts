/**
 * wizard-ci-tools — in-process MCP server exposing the WizardCiDriver.
 *
 * A thin SDK adapter over {@link WizardCiDriver}: three tools that let an
 * external driver (a test harness or an LLM) read the wizard's committed state
 * and commit decisions, driving a real run with no terminal.
 *
 *   read_state     — truthful snapshot + derived currentScreen + legal actions
 *   list_actions   — commit actions legal on the current screen
 *   perform_action — invoke one (via the store setter the Ink screen would)
 *
 * Mirrors wizard-tools.ts: pure adapter behind a seam (the driver), importing
 * no product knowledge. The driver does the work; this just speaks MCP. The
 * SDK is dynamically imported so this module loads even where the SDK is mocked.
 */

import { z } from 'zod';
import type { WizardCiDriver } from './wizard-ci-driver.js';
import { UnknownActionError, MissingParamError } from './wizard-ci-driver.js';

let _sdkModule: unknown = null;
async function getSDKModule(): Promise<{
  tool: (...args: unknown[]) => unknown;
  createSdkMcpServer: (opts: unknown) => unknown;
}> {
  if (!_sdkModule) {
    _sdkModule = await import('@anthropic-ai/claude-agent-sdk');
  }
  return _sdkModule as never;
}

export const CI_TOOLS_SERVER_NAME = 'wizard-ci-tools';

const ok = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});
const err = (message: string) => ({
  content: [{ type: 'text' as const, text: `Error: ${message}` }],
  isError: true,
});

/** Create the wizard-ci-tools MCP server bound to a live driver. */
export async function createWizardCiToolsServer(
  driver: WizardCiDriver,
): Promise<unknown> {
  const sdk = await getSDKModule();
  const { tool, createSdkMcpServer } = sdk;

  const readState = tool(
    'read_state',
    "Read the wizard's current committed state: the active screen, run phase, " +
      'a whitelisted view of the session, agent tasks/status/event-plan, any ' +
      'pending wizard_ask question, unresolved setup questions, and the commit ' +
      'actions legal right now. Call this first and after every perform_action.',
    {},
    () => ok(driver.readState()),
  );

  const listActions = tool(
    'list_actions',
    'List the commit actions legal on the current screen, with their params. ' +
      'Each maps to the same store mutation the interactive UI would perform.',
    {},
    () =>
      ok({
        currentScreen: driver.readState().currentScreen,
        actions: driver.listActions(),
      }),
  );

  const performAction = tool(
    'perform_action',
    'Commit a decision by invoking a legal action for the current screen ' +
      '(e.g. confirm_setup, choose, answer_question, set_mcp_outcome, ' +
      'dismiss_outro, keep_skills). Returns the next state. The action must ' +
      'appear in read_state.actions for the current screen.',
    {
      action: z.string().describe('Action id from read_state.actions'),
      params: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Action params, e.g. { answers: { router: "app" } }'),
    },
    (args: { action: string; params?: Record<string, unknown> }) => {
      try {
        return ok(driver.performAction(args.action, args.params ?? {}));
      } catch (e) {
        if (e instanceof UnknownActionError || e instanceof MissingParamError) {
          return err(e.message);
        }
        return err(e instanceof Error ? e.message : String(e));
      }
    },
  );

  return createSdkMcpServer({
    name: CI_TOOLS_SERVER_NAME,
    version: '1.0.0',
    tools: [readState, listActions, performAction],
  });
}

/** Fully-qualified MCP tool names, for allowedTools wiring. */
export const CI_TOOL_NAMES = {
  readState: `mcp__${CI_TOOLS_SERVER_NAME}__read_state`,
  listActions: `mcp__${CI_TOOLS_SERVER_NAME}__list_actions`,
  performAction: `mcp__${CI_TOOLS_SERVER_NAME}__perform_action`,
} as const;
