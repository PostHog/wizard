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
    // The agent made the code changes but could not install the SDK packages.
    // Common in a monorepo: the install has to write a hoisted `node_modules`
    // outside the directory the agent is sandboxed to, so it fails. We keep
    // that sandbox boundary tight on purpose (an auto-install would have to run
    // package lifecycle scripts outside the sandbox, which we won't trade for),
    // so we hand this last step to the user. Expected condition, not a bug:
    // surface a clear handoff, don't report it to error tracking. See #920 /
    // resolveAbortOutcome. The skill is left installed on this path (the
    // keep-skills prompt is success-only), so the user can finish in their own
    // AI tool.
    // TODO: the exact install command (yarn/npm/pnpm/bun) is known to the skill
    // and travels in the [ABORT] reason. Today we render a static body; a
    // follow-up could echo the skill's detected command verbatim so the user
    // sees the precise line to run.
    match: /^manual install required/i,
    message: 'One step left: install the PostHog packages',
    body:
      "Your code changes are in place, but the wizard couldn't install the " +
      'PostHog SDK packages for you. This is almost always a monorepo, where ' +
      'the install has to write outside the folder the wizard runs in. We keep ' +
      'that boundary tight on purpose, so we hand this last step to you:\n\n' +
      '  • Run it yourself: `yarn add @posthog/mcp posthog-node` (or ' +
      'npm/pnpm/bun), then re-run `npx @posthog/wizard mcp-analytics` to verify.\n' +
      '  • Or hand it to your AI coding tool: the mcp-analytics skill is still ' +
      'installed at `.claude/skills/mcp-analytics/` — point Cursor, Claude ' +
      'Code, or your agent of choice at it to pick up where we left off.\n\n' +
      'Guide: https://posthog.com/docs/mcp-analytics',
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
