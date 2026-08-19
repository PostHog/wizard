import type { AbortCase } from '@lib/agent/agent-runner';
import { createSkillProgram } from '@lib/programs/agent-skill/index';
import { tagMcpAnalyticsLanguages } from './detect.js';

const MCP_ANALYTICS_REPORT_FILE = 'posthog-mcp-analytics-report.md';

/**
 * `[ABORT]` reasons the mcp-analytics skill emits when the project can't be
 * instrumented. Kept in sync with the stop conditions in the skill's
 * `description.md` (context-mill `context/skills/mcp-analytics`).
 *
 * Matches are prefix-anchored, not exact: the reason is a slice of the model's
 * own prose, so it arrives with trailing clauses the wizard can't predict
 * ("no mcp server found` case."). `normalizeAbortReason` strips wrapper
 * punctuation, prefix anchoring absorbs the rest — an exact `$` anchor sends a
 * known case to the generic "aborted" screen over a stray word.
 */
export const MCP_ANALYTICS_ABORT_CASES: AbortCase[] = [
  {
    match: /^unsupported language for mcp analytics/i,
    code: 'unsupported_language',
    message: 'Unsupported language for MCP analytics',
    body:
      'MCP analytics supports TypeScript/JavaScript (`@posthog/mcp`) and Python ' +
      '(`posthog.mcp`, shipped inside the `posthog` package). This project ' +
      "doesn't look like either, so there's nothing to instrument. " +
      'See https://posthog.com/docs/mcp-analytics for the supported setups.',
  },
  {
    match: /^no mcp server found/i,
    code: 'no_mcp_server',
    // By far the most common way this program ends, and it's the scan that
    // decides it. A project the scan can't see through is not a wizard
    // failure, and counting it as one buries the runs that genuinely broke.
    outcome: 'not_applicable',
    // The only person who knows whether the scan was wrong is the user it just
    // turned away. The options are the four things this outcome can actually
    // mean, so the answers rank the fix: a JS/TS or Python pick is a scan miss
    // to reproduce, another language ranks the SDK backlog, a subdirectory is
    // a discoverability problem, and "no server" is nothing to fix at all.
    followUp: [
      {
        id: 'mcp_server_kind',
        kind: 'single',
        required: false,
        prompt:
          "Before you go — what's in this project? This tells us whether the " +
          'scan missed your server or MCP analytics has nothing to offer you yet.',
        options: [
          {
            label: 'A TypeScript/JavaScript MCP server the scan missed',
            value: 'typescript_javascript',
          },
          { label: 'A Python MCP server the scan missed', value: 'python' },
          {
            label: 'An MCP server in another language',
            value: 'other_language',
          },
          {
            label: 'A server in a subdirectory I should have pointed at',
            value: 'wrong_directory',
          },
          {
            label: 'No MCP server — I was after something else',
            value: 'no_server',
          },
        ],
      },
    ],
    message: 'No MCP server found',
    body:
      'This command instruments an MCP server you own, so that it reports on ' +
      "its own tool calls — and it couldn't find one here. Three things this " +
      'usually means:\n\n' +
      '• The server lives in a subdirectory — re-run with `--install-dir` pointed at the package that constructs it.\n' +
      '• The server is built in a way the scan missed — the SDK can wrap any ' +
      'server, and https://posthog.com/docs/mcp-analytics/installation has the ' +
      'manual snippet for both the wrapper and custom-dispatcher shapes.\n' +
      '• You wanted the PostHog MCP server in your coding agent instead — that ' +
      'is `npx @posthog/wizard mcp add`, and plain product analytics is ' +
      '`npx @posthog/wizard`.',
    docsUrl: 'https://posthog.com/docs/mcp-analytics/installation',
  },
  {
    match: /^could not locate the server entry point/i,
    code: 'no_server_entrypoint',
    message: 'Could not locate the MCP server entry point',
    body:
      "This project has MCP signals, but the agent couldn't find where the " +
      "server is constructed or requests are dispatched, so there's nowhere " +
      'safe to add instrumentation. See https://posthog.com/docs/mcp-analytics ' +
      'for the supported server styles, or point the wizard at the package ' +
      "that defines the server if it's in a monorepo subdirectory.",
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
  // Tags the run with the project's language before the agent runs, so an
  // `unsupported_language` abort says which language was turned away.
  onReady: ({ session }) => tagMcpAnalyticsLanguages(session.installDir),
});
