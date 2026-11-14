import { bindPiCancellation } from '../cancellation';

it.each(['after', 'before'])(
  'aborts the session once and waits for idle when the host cancels %s binding',
  async (when) => {
    const controller = new AbortController();
    if (when === 'before') controller.abort();
    let release: (() => void) | undefined;
    const abort = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const binding = bindPiCancellation(controller.signal, { abort });
    expect(() => controller.abort()).not.toThrow();
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
  },
);

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
