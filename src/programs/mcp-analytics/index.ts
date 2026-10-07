import type { AbortCase } from '@agent/types';
import { ErrorCodes } from '@shared/errors';
import { createSkillProgram } from '../shared/skill-program';

const MCP_ANALYTICS_REPORT_FILE = 'posthog-mcp-analytics-report.md';

/**
 * `[ABORT]` reasons the mcp-analytics skill emits when the project can't be
 * instrumented. Kept in sync with the stop conditions in the skill's
 * `description.md` (context-mill `context/skills/mcp-analytics`).
 */
export const MCP_ANALYTICS_ABORT_CASES: AbortCase[] = [
  {
    match: /^unsupported language for mcp analytics$/i,
    errorCode: ErrorCodes.DetectUnsupportedPlatform,
    message: 'Unsupported language for MCP analytics',
    body:
      'MCP analytics supports TypeScript/JavaScript (`@posthog/mcp`), Python ' +
      '(`posthog.mcp`, shipped inside the `posthog` package), Go ' +
      '(`posthogmcpsdk`, for servers built on the official go-sdk), and Ruby ' +
      '(`PostHog::MCP`, shipped inside the `posthog-ruby` gem, experimental). ' +
      "This project doesn't look like any of them, so there's nothing to " +
      'instrument. ' +
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
    match: /^go mcp server is not built on the official go-sdk$/i,
    message: 'Go MCP server not built on the official go-sdk',
    body:
      'The Go SDK instruments servers built on the official ' +
      '`github.com/modelcontextprotocol/go-sdk`. This server uses another ' +
      'library, so there is no one-line setup. See ' +
      'https://posthog.com/docs/mcp-analytics/installation/go for the supported setup.',
  },
  {
    match: /^go toolchain older than 1\.25$/i,
    message: 'Go toolchain older than 1.25',
    body:
      '`posthogmcpsdk` needs Go 1.25 or later, and the installed toolchain ' +
      "couldn't switch to a newer one. Upgrade Go, then run the command again.",
  },
  {
    match: /^ruby mcp server is not built on the official mcp gem$/i,
    message: 'Ruby MCP server not built on the official mcp gem',
    body:
      'The Ruby SDK instruments servers built on the official `mcp` gem, or ' +
      'a custom dispatcher through `PostHog::MCP::Client`. This server uses ' +
      'another library. See https://posthog.com/docs/mcp-analytics/installation/ruby ' +
      'for the supported setups.',
  },
  {
    match: /^ruby older than 3\.0$/i,
    message: 'Ruby older than 3.0',
    body:
      '`PostHog::MCP` needs Ruby 3.0 or later. Upgrade Ruby, then run the ' +
      'command again.',
  },
  {
    match: /^ruby mcp gem older than 1\.4$/i,
    message: 'Ruby mcp gem older than 1.4',
    body:
      '`PostHog::MCP.instrument` needs the `mcp` gem at 1.4 or later. The ' +
      "wizard doesn't change your `mcp` version. Upgrade it, then run the " +
      'command again.',
  },
  {
    match: /^could not locate the server entry point$/i,
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
 * Instruments the user's own MCP server with the PostHog MCP SDK for its
 * language (TypeScript, Python, Go, or Ruby) so it reports `$mcp_*` analytics about
 * itself. This is the opposite of `wizard mcp add` (which installs the
 * PostHog MCP *server* into a coding agent) — keep the two distinct.
 *
 * Flat while instrumenting is the only action. If an uninstrument / `remove`
 * leaf ever lands, restructure into a family with `familyCommandFactory` and
 * publish each leaf as a `cliEntries` entry with `parentCommand:
 * 'mcp-analytics'` from context-mill — a deliberate breaking change, done then,
 * not pre-emptively.
 */
export const config = createSkillProgram({
  skillId: 'mcp-analytics',
  command: 'mcp-analytics',
  id: 'mcp-analytics',
  description: 'Add PostHog MCP Analytics to your MCP server',
  integrationLabel: 'mcp-analytics',
  customPrompt:
    "Instrument this project's MCP server with PostHog MCP analytics. Run the " +
    '`mcp-analytics` skill end-to-end: detect the language and server ' +
    'style, install the PostHog MCP SDK for that language (`@posthog/mcp` for ' +
    'TypeScript, `posthog` for Python, `posthogmcpsdk` for Go, `posthog-ruby` ' +
    'for Ruby), wrap the server ' +
    '(or use the custom-dispatcher client where the skill says so), wire the ' +
    'project API key and host, and verify. ' +
    'Make only additive changes — do not alter tool behavior. For a Ruby ' +
    'server, the report must open by saying the Ruby SDK is experimental and ' +
    'not officially supported. The final report ' +
    `is written to ./${MCP_ANALYTICS_REPORT_FILE}.`,
  successMessage: `MCP analytics configured! View the report at ./${MCP_ANALYTICS_REPORT_FILE}`,
  reportFile: MCP_ANALYTICS_REPORT_FILE,
  docsUrl: 'https://posthog.com/docs/mcp-analytics',
  spinnerMessage: 'Setting up MCP analytics...',
  estimatedDurationMinutes: 5,
  abortCases: MCP_ANALYTICS_ABORT_CASES,
});
