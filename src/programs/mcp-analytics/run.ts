import type { AbortCase } from '@agent/types';
import { ErrorCodes } from '@shared/errors';
import type { SkillProgramOptions } from '@programs/agent-skill/run-definition';

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
      'MCP analytics supports TypeScript/JavaScript (`@posthog/mcp`) and Python ' +
      '(`posthog.mcp`, shipped inside the `posthog` package). This project ' +
      "doesn't look like either, so there's nothing to instrument. " +
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

export const MCP_ANALYTICS_OPTIONS: SkillProgramOptions = {
  skillId: 'mcp-analytics',
  command: 'mcp-analytics',
  id: 'mcp-analytics',
  description: 'Add PostHog MCP Analytics to your MCP server',
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
};
