/** The CLI is the one caller of process.exit: it applies the code a host resolves. */
import { underSignals, withSignals } from '../signals';

let exit: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
});
afterEach(() => vi.restoreAllMocks());

it.each([0, 1, 130])('exits with the %i the host resolves', async (code) => {
  withSignals(() => Promise.resolve(code));
  await vi.waitFor(() => expect(exit).toHaveBeenCalledExactlyOnceWith(code));
});

it("aborts the host's signal on SIGTERM with the signal name", async () => {
  const listeners = process.listenerCount('SIGTERM');
  let signal: AbortSignal | undefined;
  withSignals((s) => {
    signal = s;
    return new Promise<number>((resolve) =>
      s.addEventListener('abort', () => resolve(143)),
    );
  });
  process.emit('SIGTERM', 'SIGTERM');
  expect(signal?.reason).toBe('SIGTERM');
  await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(143));
  expect(process.listenerCount('SIGTERM')).toBe(listeners);
});

it('prints the PHW error line and exits 1 when the host rejects', async () => {
  const stderr = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(() => true);
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
