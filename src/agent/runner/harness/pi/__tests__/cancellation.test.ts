import { bindPiCancellation } from '../cancellation';

describe('Pi host cancellation', () => {
  it('aborts a live session once and waits for it to become idle', async () => {
    const controller = new AbortController();
    let release: (() => void) | undefined;
    const abort = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const binding = bindPiCancellation(controller.signal, { abort });
    expect(() => controller.abort()).not.toThrow();
    controller.abort();
    await Promise.resolve();
    expect(abort).toHaveBeenCalledOnce();
    let settled = false;
    const waiting = binding.settle().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    release?.();
    await waiting;
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
