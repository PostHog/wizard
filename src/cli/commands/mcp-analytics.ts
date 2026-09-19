import { mcpAnalyticsConfig } from '@store/programs';

import type { Command } from './command.js';
import { nativeCommandFactory } from './factories/native-command-factory.js';

/**
 * `wizard mcp-analytics` — flat skill command, instrument-an-MCP-server today.
 *
 * Distinct from `wizard mcp add`: this instruments the user's own MCP server
 * with the `@posthog/mcp` SDK, rather than installing the PostHog MCP server
 * into a coding agent. Stays flat while instrumenting is the only action.
 */
export const mcpAnalyticsCommand: Command =
  nativeCommandFactory(mcpAnalyticsConfig);
