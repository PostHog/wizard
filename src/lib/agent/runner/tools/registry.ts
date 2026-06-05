import {
  readTool,
  writeTool,
  editTool,
  globTool,
  grepTool,
} from './filesystem';
import { bashTool } from './bash';
import {
  taskCreateTool,
  taskUpdateTool,
  taskGetTool,
  taskListTool,
} from './tasks';
import { listMcpResourcesTool } from './list-mcp-resources';
import { type ToolContext, type ToolDefinition } from './types';
import type {
  HarnessToolDispatcher,
  HarnessToolResult,
} from '../harness-runner';
import type { MessagesToolUseBlock } from '../messages-client';

/**
 * The built-in tools the harness advertises and executes — the in-house
 * equivalent of the SDK's `claude_code` tool preset. Security gating is layered
 * on separately (PR 05); this is execution only.
 */
export const BUILTIN_TOOLS: ToolDefinition[] = [
  readTool,
  writeTool,
  editTool,
  globTool,
  grepTool,
  bashTool,
  taskCreateTool,
  taskUpdateTool,
  taskGetTool,
  taskListTool,
  listMcpResourcesTool,
];

/** Shape advertised on the Messages `tools` param. */
export interface AnthropicToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** Project the tool definitions into the Messages-API `tools` array. */
export function toAnthropicTools(
  defs: ToolDefinition[] = BUILTIN_TOOLS,
): AnthropicToolSpec[] {
  return defs.map((d) => ({
    name: d.name,
    description: d.description,
    input_schema: d.inputSchema,
  }));
}

/**
 * Build a dispatcher that routes a model `tool_use` block to its handler.
 * Unknown tools and thrown handler errors come back as `is_error` results
 * rather than aborting the loop — matching how the SDK surfaces tool failures.
 */
export function createToolDispatcher(
  ctx: ToolContext,
  defs: ToolDefinition[] = BUILTIN_TOOLS,
): HarnessToolDispatcher {
  const byName = new Map(defs.map((d) => [d.name, d]));
  return {
    async dispatch(block: MessagesToolUseBlock): Promise<HarnessToolResult> {
      const def = byName.get(block.name);
      if (!def) {
        return { content: `Unknown tool: ${block.name}`, isError: true };
      }
      try {
        return await def.handler(block.input, ctx);
      } catch (e) {
        return {
          content: `Tool ${block.name} failed: ${
            e instanceof Error ? e.message : String(e)
          }`,
          isError: true,
        };
      }
    },
  };
}
