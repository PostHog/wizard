import { withTaskDeadline, TaskDeadlineExceeded } from '../task-deadline';

afterEach(() => vi.useRealTimers());

it('cancels the whole task across repeated commands and waits for cleanup', async () => {
  vi.useFakeTimers();
  let commands = 0;
  let cleaned = false;
  let release!: () => void;
  const cleanup = new Promise<void>((resolve) => {
    release = resolve;
  });
  const result = withTaskDeadline(100, undefined, async (signal) => {
    while (!signal?.aborted) {
      commands++;
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
    }
    await cleanup;
    cleaned = true;
    return 'success';
  }).catch((error: unknown) => error);
  let settled = false;
  void result.then(() => {
    settled = true;
  });
  await vi.advanceTimersByTimeAsync(120);
  expect(commands).toBe(4);
  expect(settled).toBe(false);
  release();
  expect(await result).toBeInstanceOf(TaskDeadlineExceeded);
  expect(cleaned).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it('preserves host cancellation instead of turning it into a timeout', async () => {
  vi.useFakeTimers();
  const host = new AbortController();
  const result = withTaskDeadline(100, host.signal, async (signal) => {
    await new Promise<void>((resolve) =>
      signal?.addEventListener('abort', () => resolve(), { once: true }),
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    return 'cancelled';
  });
  host.abort();
  await vi.advanceTimersByTimeAsync(200);
  expect(await result).toBe('cancelled');
  expect(vi.getTimerCount()).toBe(0);
});

it('clears the deadline after success and after a harness failure', async () => {
  vi.useFakeTimers();
  let taskSignal: AbortSignal | undefined;
  expect(
    await withTaskDeadline(100, undefined, (signal) => {
      taskSignal = signal;
      return Promise.resolve('ok');
    }),
  ).toBe('ok');
  await vi.advanceTimersByTimeAsync(200);
  expect(taskSignal?.aborted).toBe(false);
  const failure = new Error('security stop');
  await expect(
    withTaskDeadline(100, undefined, () => Promise.reject(failure)),
  ).rejects.toBe(failure);
  expect(vi.getTimerCount()).toBe(0);
});

it('returns a result that outranks the deadline, and still times out on any other', async () => {
  vi.useFakeTimers();
  const finish = (result: string) =>
    withTaskDeadline(
      10,
      undefined,
      async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        return result;
      },
      undefined,
      (value) => value === 'security stop',
    ).catch((error: unknown) => error);
  const stopped = finish('security stop');
  const other = finish('abort');
  await vi.advanceTimersByTimeAsync(20);
  expect(await stopped).toBe('security stop');
  expect(await other).toBeInstanceOf(TaskDeadlineExceeded);
});

it('reports the interrupted command on one bounded line', async () => {
  vi.useFakeTimers();
  const result = withTaskDeadline(
    10,
    undefined,
    (signal) =>
      new Promise<void>((resolve) =>
        signal?.addEventListener('abort', () => resolve(), { once: true }),
      ),
    () => `eslint \n  ${'src/file.ts '.repeat(50)}`,
  ).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(10);
  const { command } = (await result) as TaskDeadlineExceeded;
  expect(command).toMatch(/^eslint src\/file\.ts /);
  expect(command?.length).toBe(201);
  expect(command).not.toContain('\n');
});
