import type { TaskEntry } from '../../agent-interface';

/**
 * Built-in tool support for the harness runner.
 *
 * The SDK's `claude_code` preset supplies Read/Write/Edit/Glob/Grep/Bash and
 * the Task* tools "for free" via its bundled cli.js. The harness has no cli.js,
 * so it implements them here and advertises them on the Messages `tools` param.
 *
 * Security gating (canUseTool allowlist + YARA hooks) is deliberately NOT here
 * — that is PR 05. This module is about correct execution only.
 */

/** Per-run context handed to every tool handler. */
export interface ToolContext {
  /** Absolute working directory the run operates in. */
  workingDirectory: string;
  /** Shared task store (same shape the SDK Task tools accumulated into). */
  tasks: Map<string, TaskEntry>;
  /** Notified after any task mutation so the UI can re-render todos. */
  onTasksChange?: (tasks: Map<string, TaskEntry>) => void;
}

/** A tool's outcome, serialized into a `tool_result` block by the loop. */
export interface ToolResult {
  content: string;
  isError?: boolean;
}

/** A built-in tool: model-facing schema + a handler. */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema advertised to the model on the Messages `tools` param. */
  inputSchema: Record<string, unknown>;
  handler: (input: unknown, ctx: ToolContext) => Promise<ToolResult>;
}

/** Convenience: a successful textual result. */
export function ok(content: string): ToolResult {
  return { content };
}

/** Convenience: an error result (becomes `is_error: true` on the tool_result). */
export function err(message: string): ToolResult {
  return { content: message, isError: true };
}
