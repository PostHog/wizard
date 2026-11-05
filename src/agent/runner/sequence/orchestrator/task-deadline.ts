import { TaskStatus, type QueueStore, type QueuedTask } from './queue';

export class TaskDeadlineExceeded extends Error {
  constructor(timeoutMs: number, command?: string) {
    super(
      `Task incomplete: exceeded its ${
        timeoutMs / 1000
      }-second time limit. Active work was cancelled; this task will not be retried.${
        command ? ` Interrupted command: ${command}` : ''
      }`,
    );
    this.name = 'TaskDeadlineExceeded';
  }
}

/** Cancel through the harness signal and join its cleanup before returning a timeout. */
export async function withTaskDeadline<T>(
  timeoutMs: number | undefined,
  signal: AbortSignal | undefined,
  run: (signal: AbortSignal | undefined) => Promise<T>,
  activeCommand?: () => string | undefined,
): Promise<T> {
  if (timeoutMs === undefined) return run(signal);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  let expired: TaskDeadlineExceeded | undefined;
  const timer = setTimeout(() => {
    expired = new TaskDeadlineExceeded(timeoutMs, activeCommand?.());
    controller.abort();
  }, timeoutMs);
  let result: T;
  try {
    result = await run(controller.signal);
  } catch (error) {
    if (expired && !signal?.aborted) throw expired;
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
  if (expired && !signal?.aborted) throw expired;
  return result;
}

/** How a queued task ended at its deadline; only `fatal` stops the run. */
export type DeadlineLanding = 'settled' | 'optional-failed' | 'fatal';

/** Settle a task whose deadline passed, leaving a task that already reported untouched. */
export function landTaskDeadline(
  store: QueueStore,
  task: QueuedTask,
  message: string,
): DeadlineLanding {
  if (store.get(task.id)?.status !== TaskStatus.Running) return 'settled';
  store.failTerminally(task.id, { type: 'timeout', message });
  return task.optional === true ? 'optional-failed' : 'fatal';
}
