import type { WizardUI, SpinnerHandle } from './wizard-ui';
import type { AgentInteraction, AgentProgress } from '@agent/types';
import { logToFile } from '@utils/debug';

// ── Progress → WizardUI, one call per event ───────────────────────────

/**
 * The inverse of the agent's former `getUI()` calls: one event, one
 * `WizardUI` method, synchronous, in emission order. Because each case maps
 * back to exactly the call the agent used to make, the frame and flow goldens
 * hold without regeneration.
 */
export function createUiReducer(ui: WizardUI): (event: AgentProgress) => void {
  let spinner: SpinnerHandle | undefined;
  return (event) => {
    switch (event.kind) {
      case 'lifecycle':
        if (event.phase === 'started') ui.startRun();
        else ui.outro(event.message);
        break;
      case 'spinner': {
        const handle = (spinner ??= ui.spinner());
        handle[event.action](event.message);
        break;
      }
      case 'log':
        ui.log[event.level](event.message);
        break;
      case 'status':
        ui.pushStatus(event.message);
        break;
      case 'tasks':
        ui.syncTodos(event.tasks);
        break;
      case 'stage':
        ui.setStage(event.stage);
        break;
      case 'url':
        if (event.which === 'dashboard') ui.setDashboardUrl(event.url);
        else ui.setNotebookUrl(event.url);
        break;
      case 'usage':
        ui.addTokenUsage(event.delta);
        break;
      case 'finalCost':
        ui.setFinalTokenCostUsd(event.usd);
        break;
      case 'authError':
        ui.showAuthError(event.detail);
        break;
      case 'handoff':
        ui.setHandoffText(event.text);
        break;
      case 'completion':
        ui.setOutroData(event.outro);
        break;
      default: {
        const unhandled: never = event;
        throw new Error(
          `Unhandled agent progress: ${JSON.stringify(unhandled)}`,
        );
      }
    }
  };
}

/** The agent's questions, answered wherever `getUI()` answers them today. */
export function uiInteraction(ui: WizardUI): AgentInteraction {
  return {
    ask: (question, { signal }) =>
      dismissOnAbort(ui.requestQuestion(question), signal, () =>
        ui.cancelPendingQuestion(),
      ),
    taskNotice: (notice, { signal }) =>
      dismissOnAbort(ui.showTaskNotice(notice), signal, () =>
        ui.cancelTaskNotice(),
      ),
  };
}

/**
 * Dismiss one open request on abort; a settled one leaves the UI alone. A
 * throw inside an abort listener reaches no caller: Node rethrows it as an
 * uncaught exception, so a broken overlay is logged here instead.
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
      logToFile('[agent-progress] dismissing an aborted request failed', error);
    }
  };
  // An abort listener added to an already aborted signal never fires.
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, { once: true });
  return open.finally(() => signal.removeEventListener('abort', onAbort));
}
