/**
 * Which guard, if any, should fail an orchestrator run once the drain returns.
 *
 * A drain can end short two ways, and they are different defects: a task
 * exhausted its retries (`Failed`), or a task never ran at all because a
 * dependency never completed (still `Pending` with nothing runnable). Both mean
 * the wizard did not set PostHog up, so both abort — but the exception has to
 * name the one that happened. A blocked-only drain has nothing in `Failed`, so
 * reporting it as "failed tasks" sent triage hunting for a failure the queue
 * state does not contain.
 */
export type DrainFailure = {
  /** Stable exception message — also the error-tracking group key. */
  error: string;
  /** The one-liner the user sees, minus the contact line. */
  reason: string;
};

export function drainFailure(args: {
  failed: number;
  blocked: number;
  /** Comma-joined types of the tasks in `Failed`, for the user-facing reason. */
  failedTypes: string;
}): DrainFailure | undefined {
  if (args.failed > 0) {
    return {
      error: 'orchestrator drain ended with failed tasks',
      reason: `the ${args.failedTypes} step failed`,
    };
  }
  if (args.blocked > 0) {
    return {
      error: 'orchestrator drain ended with tasks that never ran',
      reason: `${args.blocked} step${args.blocked === 1 ? '' : 's'} never ran`,
    };
  }
  return undefined;
}
