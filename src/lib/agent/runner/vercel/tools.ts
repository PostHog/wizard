import type { ToolSet, JSONSchema7 } from 'ai';
import {
  BUILTIN_TOOLS,
  createToolDispatcher,
  type ToolDispatcher,
} from '../shared/tools/registry';
import type { ToolContext, ToolDefinition } from '../shared/tools/types';

/**
 * Adapt the shared coding toolset to the Vercel AI SDK's tool interface.
 *
 * Each neutral `ToolDefinition` becomes a `dynamicTool`: its JSON Schema is
 * advertised verbatim via `jsonSchema()` (so the model sees the same shape the
 * SDK path's `claude_code` preset exposes), and its `execute` routes through
 * the shared dispatcher. `dynamicTool` keeps the input typed as `unknown`,
 * which matches the dispatcher's runtime-validated handlers — the AI SDK does
 * not need compile-time tool typing here.
 *
 * The `ToolLoopAgent` owns the loop and invokes `execute` itself, so the Task*
 * tools mutate the shared store and fire `ctx.onTasksChange` from inside these
 * closures; the runner wires that callback to the TUI todo sync. Security
 * gating (canUseTool + YARA) wraps the dispatcher in #525, not here. The SDK is
 * imported dynamically because the AI SDK is ESM-only.
 */
export async function createVercelTools(
  ctx: ToolContext,
  defs: ToolDefinition[] = BUILTIN_TOOLS,
): Promise<ToolSet> {
  const { dynamicTool, jsonSchema } = await import('ai');
  const dispatcher: ToolDispatcher = createToolDispatcher(ctx, defs);
  const tools: ToolSet = {};
  for (const def of defs) {
    tools[def.name] = dynamicTool({
      description: def.description,
      inputSchema: jsonSchema(def.inputSchema as JSONSchema7),
      async execute(input: unknown): Promise<string> {
        const result = await dispatcher.dispatch({ name: def.name, input });
        // The model reads the textual result either way; an error result is
        // still returned as content (with its message) rather than thrown, so
        // the loop continues and the model can recover — matching how the SDK
        // path surfaces a tool_result with is_error.
        return result.content;
      },
    });
  }
  return tools;
}
