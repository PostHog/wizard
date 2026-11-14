import type { TaskTimeoutBehavior } from './executor';
import { TaskStatus, type QueueStore, type QueuedTask } from './queue';

const MAX_COMMAND_CHARS = 200;

/** One line of bounded length, because a command reaches the outro and the report. */
function trimCommand(command: string | undefined): string | undefined {
  const line = command?.replace(/\s+/g, ' ').trim();
  if (!line) return undefined;
  return line.length > MAX_COMMAND_CHARS
    ? `${line.slice(0, MAX_COMMAND_CHARS)}…`
    : line;
}

export class TaskDeadlineExceeded extends Error {
  constructor(
    public readonly timeoutMs: number,
    public readonly command?: string,
  ) {
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
  outranksDeadline?: (result: T) => boolean,
): Promise<T> {
  if (timeoutMs === undefined) return run(signal);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  let expired: TaskDeadlineExceeded | undefined;
  const timer = setTimeout(() => {
    expired = new TaskDeadlineExceeded(
      timeoutMs,
      trimCommand(activeCommand?.()),
    );
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
  if (expired && !signal?.aborted && !outranksDeadline?.(result)) throw expired;
  return result;
}

/** How a queued task ended at its deadline; only `fatal` stops the run. */
export type DeadlineLanding =
  | 'settled'
  | 'optional-failed'
  | 'continued'
  | 'fatal';

/** Settle a task whose deadline passed, leaving a task that already reported untouched. */
export function landTaskDeadline(
  store: QueueStore,
  task: QueuedTask,
  onTimeout: TaskTimeoutBehavior | undefined,
  error: TaskDeadlineExceeded,
): DeadlineLanding {
  if (store.get(task.id)?.status !== TaskStatus.Running) return 'settled';
  const label = task.label ?? task.type;
  if (task.optional !== true && onTimeout === 'continue') {
    const conflict = `${label} stopped at its ${
      error.timeoutMs / 1000
    }-second limit, so its checks are unverified and its edits may be partial.${
      error.command ? ` Interrupted command: ${error.command}` : ''
    }`;
    store.complete(task.id, {
      goals: label,
      did: `${conflict} Active work was cancelled and the task was not retried.`,
      forNextAgent:
        'Say in the report that this step did not finish and name what is unverified. Do not claim that the build or any check passed unless an earlier handoff shows it.',
      conflict,
    });
    return 'continued';
  }
  store.failTerminally(task.id, {
    type: 'timeout',
    message: `${label}: ${error.message}`,
  });
  return task.optional === true ? 'optional-failed' : 'fatal';
}
