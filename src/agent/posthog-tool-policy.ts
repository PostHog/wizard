// A program's PostHog MCP tool allowlist, enforced on each harness's tool call.

import type { HookCallbackMatcher } from './yara-hooks';
import { logToFile } from '@utils/debug';

// Read-only discovery commands of the `exec` tool.
const DISCOVERY_VERBS: ReadonlySet<string> = new Set([
  'help',
  'tools',
  'search',
  'info',
  'schema',
]);

/** The refusal for a PostHog MCP tool outside the program's allowlist. */
export function posthogToolNotAllowed(tool: string): string {
  return `PostHog tool ${tool} is not allowed for this program. Use only the PostHog tools the task needs.`;
}

/** Why an `exec` call is refused: only discovery and `call` of a listed tool pass. */
export function posthogExecBlockReason(
  input: Record<string, unknown>,
  allowed: readonly string[],
): string | undefined {
  const command = typeof input.command === 'string' ? input.command.trim() : '';
  const [verb = '', ...rest] = command.split(/\s+/);
  // `call` takes flags such as `--json` and `--confirm` before the tool name.
  const tool = rest.find((word) => !word.startsWith('--')) ?? '';
  if (DISCOVERY_VERBS.has(verb)) return undefined;
  if (verb === 'call' && tool) {
    return allowed.includes(tool) ? undefined : posthogToolNotAllowed(tool);
  }
  return 'This PostHog command is not allowed for this program. Use `tools`, `search`, `info`, `schema` or `call <tool> <json>`.';
}

/** SDK PreToolUse hook; it fires for every call, subagents included, in any permission mode. */
export function createPostHogToolHook(
  allowed: readonly string[],
  serverName: string,
): HookCallbackMatcher {
  const prefix = `mcp__${serverName}__`;
  const blockReason = (input: Record<string, unknown>): string | undefined => {
    const toolName = typeof input.tool_name === 'string' ? input.tool_name : '';
    if (!toolName.startsWith(prefix)) return undefined;
    const tool = toolName.slice(prefix.length);
    if (tool !== 'exec')
      return allowed.includes(tool) ? undefined : posthogToolNotAllowed(tool);
    const toolInput =
      input.tool_input && typeof input.tool_input === 'object'
        ? (input.tool_input as Record<string, unknown>)
        : {};
    return posthogExecBlockReason(toolInput, allowed);
  };
  return {
    hooks: [
      (input) => {
        const reason = blockReason(input);
        if (!reason) return Promise.resolve({});
        logToFile(
          `[posthog-tools] BLOCK ${String(input.tool_name)}: ${reason}`,
        );
        return Promise.resolve({ decision: 'block', reason });
      },
    ],
  };
}
