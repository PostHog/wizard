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
import {
  type ToolContext,
  type ToolDefinition,
  type ToolResult,
} from './types';

/**
 * The shared coding toolset — the SDK-agnostic equivalent of the Anthropic
 * `claude_code` tool preset. Each runner advertises these to its model and
 * routes tool calls through `createToolDispatcher`. Security gating wraps the
 * dispatcher in the runner (#525); this is execution only.
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

/** Neutral tool spec (name + description + JSON-schema) each runner maps to its SDK's tool shape. */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Project the tool definitions into name/description/JSON-schema specs. */
export function toToolSpecs(
  defs: ToolDefinition[] = BUILTIN_TOOLS,
): ToolSpec[] {
  return defs.map((d) => ({
    name: d.name,
    description: d.description,
    inputSchema: d.inputSchema,
  }));
}

/** A model-issued tool call, in the runner-neutral shape. */
export interface ToolCall {
  name: string;
  input: unknown;
}

export interface ToolDispatcher {
  dispatch(call: ToolCall): Promise<ToolResult>;
}

/**
 * Build a dispatcher that routes a tool call to its handler. Unknown tools and
 * thrown handler errors come back as `isError` results rather than aborting the
 * loop — matching how the SDKs surface tool failures.
 */
export function createToolDispatcher(
  ctx: ToolContext,
  defs: ToolDefinition[] = BUILTIN_TOOLS,
): ToolDispatcher {
  const byName = new Map(defs.map((d) => [d.name, d]));
  return {
    async dispatch(call: ToolCall): Promise<ToolResult> {
      const def = byName.get(call.name);
      if (!def) {
        return { content: `Unknown tool: ${call.name}`, isError: true };
      }
      try {
        return await def.handler(call.input, ctx);
      } catch (e) {
        return {
          content: `Tool ${call.name} failed: ${
            e instanceof Error ? e.message : String(e)
          }`,
          isError: true,
        };
      }
    },
  };
}
