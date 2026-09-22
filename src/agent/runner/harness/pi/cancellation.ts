/** Bind a host signal to Pi's abort-and-wait-for-idle operation. */
export function bindPiCancellation(
  signal: AbortSignal | undefined,
  session: { abort(): Promise<void> },
  onAbortError?: (error: unknown) => void,
): { settle(): Promise<void> } {
  let abortPromise: Promise<void> | undefined;
  const onAbort = () => {
    abortPromise ??= session.abort().catch((error: unknown) => {
      onAbortError?.(error);
    });
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();

  return {
    async settle() {
      signal?.removeEventListener('abort', onAbort);
      await abortPromise;
    },
  };
}
