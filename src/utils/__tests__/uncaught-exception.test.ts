import { installWizardUncaughtExceptionHandler } from '@utils/uncaught-exception';

describe('installWizardUncaughtExceptionHandler', () => {
  const buildHarness = () => {
    let listener: ((error: Error) => void) | undefined;
    const runtime = {
      on: vi.fn(
        (event: 'uncaughtException', nextListener: (error: Error) => void) => {
          expect(event).toBe('uncaughtException');
          listener = nextListener;
          return runtime;
        },
      ),
      exit: vi.fn(),
    };
    const flush = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();
    const print = vi.fn();

    const options = {
      runtime,
      flush,
      log,
      print,
    };
    installWizardUncaughtExceptionHandler(options);

    if (!listener)
      throw new Error('uncaughtException listener was not installed');
    return { listener, runtime, flush, log, print, options };
  };

  it('installs only once on the same runtime', () => {
    const { runtime, options } = buildHarness();

    installWizardUncaughtExceptionHandler(options);

    expect(runtime.on).toHaveBeenCalledTimes(1);
  });

  it('keeps the wizard alive for the Node HTTP/2 idle timeout', async () => {
    const { listener, runtime, flush, log, print } = buildHarness();
    const error = new Error('socket idle timeout');
    error.name = 'InformationalError';

    listener(error);
    await Promise.resolve();

    expect(log).toHaveBeenCalledWith(
      '[uncaught-exception] ignored Node HTTP/2 idle timeout',
      error,
    );
    expect(flush).not.toHaveBeenCalled();
    expect(print).not.toHaveBeenCalled();
    expect(runtime.exit).not.toHaveBeenCalled();
  });

  it.each([
    Object.assign(new Error('socket idle timeout'), { name: 'Error' }),
    Object.assign(new Error('different failure'), {
      name: 'InformationalError',
    }),
  ])('preserves fatal handling for %s', async (error) => {
    const { listener, runtime, flush, print } = buildHarness();

    listener(error);
    await vi.waitFor(() => expect(runtime.exit).toHaveBeenCalledWith(1));

    expect(print).toHaveBeenCalledWith(error);
    expect(flush).toHaveBeenCalledWith(2_000);
  });

  it('still exits when analytics flushing fails', async () => {
    const { listener, runtime, flush } = buildHarness();
    flush.mockRejectedValueOnce(new Error('flush failed'));

    listener(new Error('boom'));
    await vi.waitFor(() => expect(runtime.exit).toHaveBeenCalledWith(1));
  });
});
