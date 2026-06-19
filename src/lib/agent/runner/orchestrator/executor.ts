/**
 * The executor drains the queue. It starts every runnable task (dependencies
 * satisfied) as soon as it becomes runnable — parallelism is decided by the
 * task graph, not by an executor knob. Each task runs through an injected
 * `runTask` function and reports its outcome via `complete_task`; a task that
 * ends without reporting is retried while attempts remain, then failed. A
 * `maxStarts` backstop guarantees termination.
 *
 * The drain loop is independent of how a task actually runs. `runTask` is
 * injected: the real one spins up a fresh agent, the tests use a fake.
 */
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import { TaskStatus, type QueueStore, type QueuedTask } from './queue';

/** Per-task agent configuration the resolver produces from a task's type. */
export interface ResolvedTask {
  model: string;
  allowedTools: readonly string[];
  disallowedTools: readonly string[];
  /** Mini-skills to install before the task runs (the HOW). */
  skills: readonly string[];
  prompt: string;
}

/** Resolves a queued task to what the agent needs. The real one is markdown-backed. */
export type TaskResolver = (
  task: QueuedTask,
  store: QueueStore,
) => ResolvedTask;

/** Runs one task's agent. It is expected to drive the task to a terminal state
 *  (via the task agent calling complete_task). */
export type RunTask = (task: QueuedTask) => Promise<void>;

export interface DrainOptions {
  /** Backstop against a pathological always-one-more-pending loop. */
  maxStarts: number;
}

export const DEFAULT_DRAIN_OPTIONS: DrainOptions = {
  maxStarts: 200,
};

async function runOne(
  store: QueueStore,
  runTask: RunTask,
  task: QueuedTask,
): Promise<void> {
  store.start(task.id);
  try {
    await runTask(task);
  } catch (error) {
    // The task threw rather than reporting. The outcome check below handles
    // the queue; the exception itself should never be silent.
    logToFile(`[executor] runTask threw for ${task.type}:`, error);
    analytics.captureException(
      error instanceof Error ? error : new Error(String(error)),
      { step: 'orchestrator_run_task', task_type: task.type },
    );
  }

  const after = store.get(task.id);
  if (!after) return;

  if (after.status === TaskStatus.Running) {
    // The agent ended without calling complete_task. Retry or fail.
    if (after.attempts < after.maxAttempts) {
      store.requeue(task.id);
    } else {
      store.fail(task.id, {
        type: 'no-report',
        message: 'Task ended without calling complete_task.',
      });
    }
    return;
  }

  if (
    after.status === TaskStatus.Failed &&
    after.attempts < after.maxAttempts
  ) {
    store.requeue(task.id);
  }
}

/**
 * Drain the queue to a terminal state. Every runnable task starts the moment
 * its dependencies finish; independent branches run concurrently. Returns when
 * every task is done, failed, or blocked by a failed dependency, or when the
 * start backstop trips.
 */
export async function drainQueue(
  store: QueueStore,
  runTask: RunTask,
  opts: DrainOptions = DEFAULT_DRAIN_OPTIONS,
): Promise<void> {
  const running = new Map<string, Promise<void>>();
  let starts = 0;

  for (;;) {
    for (const task of store.nextRunnable()) {
      if (++starts > opts.maxStarts) break;
      // runOne marks the task running synchronously, so the next
      // nextRunnable() call no longer offers it.
      const p = runOne(store, runTask, task).finally(() =>
        running.delete(task.id),
      );
      running.set(task.id, p);
    }
    if (running.size === 0) break;
    // Wake on the first finish; it may have unblocked dependents or requeued.
    await Promise.race(running.values());
  }
}
