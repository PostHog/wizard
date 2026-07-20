import type { AbortCase } from '@lib/agent/agent-runner';
import { createSkillProgram } from '@lib/programs/agent-skill/index';

const MCP_ANALYTICS_REPORT_FILE = 'posthog-mcp-analytics-report.md';

/**
 * `[ABORT]` reasons the mcp-analytics skill emits when the project can't be
 * instrumented. Kept in sync with the stop conditions in the skill's
 * `description.md` (context-mill `context/skills/mcp-analytics`).
 */
const MCP_ANALYTICS_ABORT_CASES: AbortCase[] = [
  {
    match: /^not a javascript mcp server$/i,
    message: 'Not a JavaScript/TypeScript MCP server',
    body:
      'MCP analytics is currently TypeScript/JavaScript-only — the `@posthog/mcp` ' +
      'SDK is a Node package (a Python SDK is on the roadmap). This project ' +
      "doesn't look like a JS/TS MCP server, so there's nothing to instrument. " +
      'See https://posthog.com/docs/mcp-analytics for the supported setups.',
  },
  {
    match: /^no mcp server found$/i,
    message: 'No MCP server found',
    body:
      'This command instruments an existing MCP server with PostHog analytics, ' +
      'but no MCP server was found in this project. If you just want PostHog ' +
      'product analytics, run `npx @posthog/wizard` instead.',
  },
  {
    // SDK install must write a hoisted node_modules outside the agent's
    // sandbox, so it fails. Expected, not a bug: hand off to the user instead
    // of reporting it. Capture group is the optional install command the skill
    // detected after the colon.
    match: /^manual install required(?::\s*(.+))?$/i,
    message: 'One step left: finish installing PostHog.',
    body: (match) => {
      const command = match[1]?.trim();
      const terminalStep = command
        ? `No AI tool handy? Run \`${command}\`, then re-run the wizard to verify.`
        : 'No AI tool handy? Install `@posthog/mcp` and `posthog-node` with your package manager, then re-run the wizard to verify.';
      return (
        'For security, the Wizard only writes inside this project folder. To ' +
        "install the `mcp-analytic`, it needs to write outside it, so we're " +
        'leaving it to you to complete. \n\n' +
        'The code changes are complete. Your AI coding tool can finish the rest:' +
        'the `mcp-analytics` skill is set up in this project, so just ask your ' +
        'agent to finish adding PostHog MCP analytics. Your tool can find it ' +
        'at `.claude/skills/mcp-analytics`.\n\n' +
        terminalStep
      );
    },
    docsUrl: 'https://posthog.com/docs/mcp-analytics',
  },
];

/**
 * `wizard mcp-analytics` — flat skill command.
 *
 * Instruments the user's own MCP server with the `@posthog/mcp` SDK so it
 * reports `$mcp_*` analytics about itself. This is the opposite of
 * `wizard mcp add` (which installs the PostHog MCP *server* into a coding
 * agent) — keep the two distinct.
 *
 * Flat while instrumenting is the only action. If an uninstrument / `remove`
 * leaf ever lands, restructure into a family with `familyCommandFactory` and
 * publish each leaf as a `cliEntries` entry with `parentCommand:
 * 'mcp-analytics'` from context-mill — a deliberate breaking change, done then,
 * not pre-emptively.
 */
export const mcpAnalyticsConfig = createSkillProgram({
  skillId: 'mcp-analytics',
  command: 'mcp-analytics',
  id: 'mcp-analytics',
  description: 'Add PostHog MCP analytics to your MCP server',
  integrationLabel: 'mcp-analytics',
  customPrompt:
    "Instrument this project's MCP server with PostHog MCP analytics. Run the " +
    '`mcp-analytics` skill end-to-end: detect the server style, install ' +
    '`@posthog/mcp` and `posthog-node`, wrap the server (or use `PostHogMCP` ' +
    'for a custom dispatcher), wire the project API key and host, and verify. ' +
    'Make only additive changes — do not alter tool behavior. The final report ' +
    `is written to ./${MCP_ANALYTICS_REPORT_FILE}.`,
  successMessage: `MCP analytics configured! View the report at ./${MCP_ANALYTICS_REPORT_FILE}`,
  reportFile: MCP_ANALYTICS_REPORT_FILE,
  docsUrl: 'https://posthog.com/docs/mcp-analytics',
  spinnerMessage: 'Setting up MCP analytics...',
  estimatedDurationMinutes: 5,
  abortCases: MCP_ANALYTICS_ABORT_CASES,
});
