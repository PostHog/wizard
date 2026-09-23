import { createSkillProgram } from '../agent-skill/index';
import { MCP_ANALYTICS_OPTIONS } from './run.js';
export { MCP_ANALYTICS_ABORT_CASES } from './run.js';

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
export const mcpAnalyticsConfig = createSkillProgram(MCP_ANALYTICS_OPTIONS);
