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
 * Pause between completion-guard nudges. A dead turn comes back in
 * milliseconds, so without it the guard spins through its whole cap in
 * seconds and the run aborts before the model had any chance to act.
 */
export const NUDGE_BACKOFF_MS = 1_000;

export interface NudgeRun {
  /** Nudges sent. */
  nudges: number;
  /** True when a nudge came back with no tool call and no assistant output. */
  dead: boolean;
}

/**
 * Re-prompt a pi session while its work is unfinished.
 *
 * pi's `prompt()` resolves on the first turn without a tool call, which an
 * agent mid-plan does emit, so the guard nudges it to carry on. A nudge that
 * returns without a tool call and without assistant output is dead: the model
 * has nothing more to give, and every further nudge returns just as empty, so
 * the cap drains and the run aborts with no work done. Stop on the first dead
 * nudge, and space live ones out.
 */
export async function nudgeWhileUnfinished(args: {
  max: number;
  /** True while the guard should keep nudging. */
  unfinished: () => boolean;
  /** Work the run has done: tool calls plus assistant output. */
  progress: () => number;
  send: (nudge: number) => Promise<void>;
  backoffMs?: number;
}): Promise<NudgeRun> {
  const backoffMs = args.backoffMs ?? NUDGE_BACKOFF_MS;
  let nudges = 0;
  while (nudges < args.max && args.unfinished()) {
    if (nudges > 0) {
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
    const before = args.progress();
    nudges += 1;
    await args.send(nudges);
    if (args.progress() === before) return { nudges, dead: true };
  }
  return { nudges, dead: false };
}
