/**
 * The stable exception name for a drain that ended short, or `undefined` when
 * the drain finished everything.
 *
 * A drain can end short two ways, and they are different defects: a task
 * exhausted its retries (`Failed`), or a task never ran at all because a
 * dependency never completed (still `Pending` with nothing runnable). Both mean
 * the wizard did not set PostHog up, so both abort — but the exception name is
 * also the error-tracking group key, so it has to name the one that happened.
 * A blocked-only drain has nothing in `Failed`, so grouping it under "failed
 * tasks" sent triage hunting for a failure the queue state does not contain.
 *
 * The user-facing line is composed separately by `describeDrainFailure`, which
 * names both the step that failed and the steps it stranded.
 */
export function drainFailureError(args: {
  failed: number;
  blocked: number;
}): string | undefined {
  if (args.failed > 0) {
    return 'orchestrator drain ended with failed tasks';
  }
  if (args.blocked > 0) {
    return 'orchestrator drain ended with tasks that never ran';
  }
  return undefined;
}
