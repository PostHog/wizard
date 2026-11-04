/** Tool timing for one agent session: totals for `agent completed`, and each slow call as `tool slow`. */

import { analytics } from '@utils/analytics';

/** A tool call at least this long is reported on its own. */
export const SLOW_TOOL_MS = 30_000;

/** Shell words that only set up the command that does the work. */
const SETUP_WORDS = new Set(['cd', 'export', 'set', 'source', '.']);

/** The program a bash command spends its time in, as a bare name, or undefined. */
export function commandProgram(command: unknown): string | undefined {
  if (typeof command !== 'string') return undefined;
  for (const segment of command.split(/&&|\|\||[;|]/)) {
    const words = segment
      .trim()
      .split(/\s+/)
      .filter((word) => word && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
    const first = words[0];
    if (!first || SETUP_WORDS.has(first)) continue;
    const name = first.split('/').pop() ?? '';
    return /^[A-Za-z0-9._-]{1,40}$/.test(name) ? name : undefined;
  }
  return undefined;
}

export type ToolTimingSummary = {
  tool_calls: number;
  tool_time_ms: number;
  slowest_tool?: string;
  slowest_tool_ms?: number;
};

/** Feed it the session's tool events; `properties` ride on every `tool slow` event. */
export function createToolTiming(properties: Record<string, unknown> = {}) {
  const programs = new Map<string, string>();
  let calls = 0;
  let totalMs = 0;
  let slowest: { tool: string; ms: number } | undefined;

  return {
    start(toolCallId: string, toolName: string, args: unknown): void {
      if (toolName !== 'bash') return;
      const program = commandProgram((args as { command?: unknown })?.command);
      if (program) programs.set(toolCallId, program);
    },
    end(
      toolCallId: string,
      toolName: string,
      isError: boolean,
      durationMs: number | undefined,
    ): void {
      const program = programs.get(toolCallId);
      programs.delete(toolCallId);
      if (durationMs === undefined) return;
      const ms = Math.round(durationMs);
      calls += 1;
      totalMs += ms;
      if (!slowest || ms > slowest.ms) slowest = { tool: toolName, ms };
      if (ms < SLOW_TOOL_MS) return;
      analytics.wizardCapture('tool slow', {
        tool: toolName,
        duration_ms: ms,
        is_error: isError,
        ...(program ? { command_program: program } : {}),
        ...properties,
      });
    },
    summary(): ToolTimingSummary {
      return {
        tool_calls: calls,
        tool_time_ms: totalMs,
        ...(slowest
          ? { slowest_tool: slowest.tool, slowest_tool_ms: slowest.ms }
          : {}),
      };
    },
  };
}
