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
