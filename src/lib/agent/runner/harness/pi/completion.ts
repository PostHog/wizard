import { AgentErrorType } from '@lib/agent/signals';

/** Which completion guard should fail a pi run, or undefined for a clean finish. */
export function completionFailure(args: {
  toolCalls: number;
  openTasks: boolean;
}): AgentErrorType | undefined {
  // No tool call at all — the project was never touched.
  if (args.toolCalls === 0) return AgentErrorType.NO_PROGRESS;
  // Acted but left tasks in its own plan unfinished (skill install not required).
  if (args.openTasks) return AgentErrorType.INCOMPLETE_TASKS;
  return undefined;
}

/**
 * Which error type a thrown pi run reports.
 *
 * Both pi entry points classified the caught message inline with the same two
 * needles, and both did it *after* firing `agent aborted` — so the event that
 * announces the abort could not name it. Pulling the classification out lets
 * each entry point decide the type first and hand it to the event, and keeps
 * the one rule in one place.
 */
export function runErrorType(message: string): AgentErrorType {
  const lower = message.toLowerCase();
  if (lower.includes('rate limit') || lower.includes('429')) {
    return AgentErrorType.RATE_LIMIT;
  }
  return AgentErrorType.API_ERROR;
}
