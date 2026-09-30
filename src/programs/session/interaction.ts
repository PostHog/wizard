import { logToFile } from '@utils/debug';

/**
 * Dismiss one open request on abort; a settled one leaves the UI alone. A
 * throw inside an abort listener reaches no caller: Node rethrows it as an
 * uncaught exception, so a broken overlay is logged here instead.
 */
export function dismissOnAbort<T>(
  open: Promise<T>,
  signal: AbortSignal,
  dismiss: () => void,
): Promise<T> {
  const onAbort = () => {
    try {
      dismiss();
    } catch (error) {
      logToFile('[agent-progress] dismissing an aborted request failed', error);
    }
  };
  // An abort listener added to an already aborted signal never fires.
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, { once: true });
  return open.finally(() => signal.removeEventListener('abort', onAbort));
}
