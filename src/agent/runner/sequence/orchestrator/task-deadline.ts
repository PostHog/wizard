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
