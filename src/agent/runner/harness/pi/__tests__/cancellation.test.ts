import { bindPiCancellation } from '../cancellation';

describe('Pi host cancellation', () => {
  it('aborts a live session once and waits for it to become idle', async () => {
    const controller = new AbortController();
    let finishAbort!: () => void;
    const abort = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishAbort = resolve;
        }),
    );
    const binding = bindPiCancellation(controller.signal, { abort });

    controller.abort();
    controller.abort();
    await Promise.resolve();
    expect(abort).toHaveBeenCalledTimes(1);
    let settled = false;
    const settling = binding.settle().then(() => {
      settled = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);

    finishAbort();
    await settling;
    expect(settled).toBe(true);
  });

  it('honours a signal already aborted before the session is bound', async () => {
    const controller = new AbortController();
    controller.abort();
    const abort = vi.fn().mockResolvedValue(undefined);
    const binding = bindPiCancellation(controller.signal, { abort });

    await binding.settle();
    expect(abort).toHaveBeenCalledTimes(1);
  });
  it('contains a synchronous abort throw and a diagnostic callback throw', async () => {
    const controller = new AbortController();
    const binding = bindPiCancellation(
      controller.signal,
      {
        abort: () => {
          throw new Error('abort failed');
        },
      },
      () => {
        throw new Error('log failed');
      },
    );
    expect(() => controller.abort()).not.toThrow();
    await expect(binding.settle()).resolves.toBeUndefined();
  });
});
