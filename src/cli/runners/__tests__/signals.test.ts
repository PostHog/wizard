/** The CLI is the one caller of process.exit: it applies the code a host resolves. */
import { underSignals, withSignals } from '../signals';

let exit: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
});
afterEach(() => vi.restoreAllMocks());

// A write mock that reports completion, as a drained stream does.
const flushed = (...[, cb]: unknown[]) => {
  if (typeof cb === 'function') cb();
  return true;
};

it.each([0, 1, 130])('exits with the %i the host resolves', async (code) => {
  withSignals(() => Promise.resolve(code));
  await vi.waitFor(() => expect(exit).toHaveBeenCalledExactlyOnceWith(code));
});

it('waits for stdout to flush before it exits', async () => {
  let release: () => void = () => undefined;
  vi.spyOn(process.stdout, 'write').mockImplementation(((
    ...[, cb]: unknown[]
  ) => {
    release = cb as () => void;
    return true;
  }) as never);
  vi.spyOn(process.stderr, 'write').mockImplementation(flushed as never);
  withSignals(() => Promise.resolve(0));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(exit).not.toHaveBeenCalled();
  release();
  await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
});

it.each([
  ['SIGINT', 130],
  ['SIGTERM', 143],
  // A closed terminal: the hosts end it like Ctrl-C.
  ['SIGHUP', 130],
] as const)(
  "aborts the host's signal on %s with the signal name",
  async (name, code) => {
    const listeners = process.listenerCount(name);
    let signal: AbortSignal | undefined;
    withSignals((s) => {
      signal = s;
      return new Promise<number>((resolve) =>
        s.addEventListener('abort', () => resolve(code)),
      );
    });
    process.emit(name, name);
    expect(signal?.reason).toBe(name);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(code));
    expect(process.listenerCount(name)).toBe(listeners);
  },
);

it('prints the PHW error line and exits 1 when the host rejects', async () => {
  const stderr = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(flushed as never);
  withSignals(() => Promise.reject(new Error('host crashed')));
  await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  expect(stderr).toHaveBeenCalledWith(
    expect.stringContaining('"code":"PHW_INTERNAL_UNHANDLED"'),
  );
});

it('rejects with a host that cannot start, with no signal listeners left', async () => {
  const before = process.listenerCount('SIGINT');
  await expect(
    underSignals(() => {
      throw new Error('Raw mode is not supported');
    }),
  ).rejects.toThrow('Raw mode is not supported');
  expect(process.listenerCount('SIGINT')).toBe(before);
  expect(exit).not.toHaveBeenCalled();
});
