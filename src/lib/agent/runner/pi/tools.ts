import type { Tool } from '@openai/agents';
import {
  BUILTIN_TOOLS,
  createToolDispatcher,
  type ToolDispatcher,
} from '../shared/tools/registry';
import type { ToolContext, ToolDefinition } from '../shared/tools/types';

/**
 * The OpenAI Agents SDK's non-strict JSON-schema tool parameter shape. Building
 * the parameters this way (rather than from a Zod schema) keeps the adapter off
 * the SDK's `strict: true` + Zod path — our handlers already validate their
 * input at runtime via Zod, so the model-facing schema only needs to advertise
 * the shape.
 */
interface NonStrictParameters {
  type: 'object';
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  additionalProperties: true;
}

/**
 * Normalize a neutral `ToolDefinition.inputSchema` into the SDK's non-strict
 * parameter object: it requires `required` and `additionalProperties` to be
 * present, which our JSON Schemas leave implicit.
 */
export function toNonStrictParameters(
  inputSchema: Record<string, unknown>,
): NonStrictParameters {
  const properties =
    (inputSchema.properties as Record<string, Record<string, unknown>>) ?? {};
  const required = Array.isArray(inputSchema.required)
    ? (inputSchema.required as string[])
    : [];
  return { type: 'object', properties, required, additionalProperties: true };
}

/**
 * Adapt the shared coding toolset to the OpenAI Agents SDK's `tool()` shape.
 *
 * Each neutral `ToolDefinition` becomes a non-strict function tool whose
 * `execute` routes through the shared dispatcher; the SDK's `run()` loop drives
 * the calls. The Task* handlers mutate the shared store and fire
 * `ctx.onTasksChange` from inside these closures, which the runner wires to the
 * TUI todo sync. Security gating (canUseTool + YARA) wraps the dispatcher in
 * #525, not here. The SDK is ESM-only, so it's imported dynamically.
 */
export async function createPiTools(
  ctx: ToolContext,
  defs: ToolDefinition[] = BUILTIN_TOOLS,
): Promise<Tool[]> {
  const { tool } = await import('@openai/agents');
  const dispatcher: ToolDispatcher = createToolDispatcher(ctx, defs);
  return defs.map((def) =>
    tool({
      name: def.name,
      description: def.description,
      parameters: toNonStrictParameters(def.inputSchema),
      strict: false,
      async execute(input: unknown): Promise<string> {
        const result = await dispatcher.dispatch({ name: def.name, input });
        // Return the textual result even on error (rather than throwing) so the
        // loop continues and the model can recover — matching the SDK path's
        // tool_result with is_error.
        return result.content;
      },
    }),
  );
}
