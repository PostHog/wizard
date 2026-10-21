/** The agent's questions and notices, held in a session store until an answerer resolves them. */
import type { AgentInteraction } from '@agent/types';
import { logToFile } from '@utils/debug';
import type { SessionStore } from './session-store';

/**
 * Hold each ask and notice in `store` until someone answers it: the TUI's
 * WizardAsk screen, or an embedder's answerer. An abort dismisses the open request.
 */
export function storeInteraction(store: SessionStore): AgentInteraction {
  return {
    ask: (question, { signal, onAnswer }) =>
      dismissOnAbort(store.requestQuestion(question, onAnswer), signal, () =>
        store.cancelPendingQuestion(),
      ),
    taskNotice: (notice, { signal }) =>
      dismissOnAbort(store.showTaskNotice(notice), signal, () =>
        store.resolveTaskNotice(false),
      ),
  };
}

/**
 * Dismiss one open request on abort; a settled one is left alone. A throw
 * inside an abort listener reaches no caller: Node rethrows it as an uncaught
 * exception, so a failed dismissal is logged here instead.
 */
function dismissOnAbort<T>(
  open: Promise<T>,
  signal: AbortSignal,
  dismiss: () => void,
): Promise<T> {
  const onAbort = () => {
    try {
      dismiss();
    } catch (error) {
      logToFile('[interaction] dismissing an aborted request failed', error);
    }
  };
  // An abort listener added to an already aborted signal never fires.
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, { once: true });
  return open.finally(() => signal.removeEventListener('abort', onAbort));
}
