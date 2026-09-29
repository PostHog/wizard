/** A run's progress as log lines: one `LoggingUI` call per event that has something to print. */
import type { SpinnerHandle } from '@agent/types';
import type { ProgramProgress } from '@programs/types';
import type { LoggingUI } from './logging-ui';

export function logProgress(
  log: LoggingUI,
): (progress: ProgramProgress) => void {
  const spinners = new Map<string, SpinnerHandle>();
  return ({ runId, event }) => {
    switch (event.kind) {
      case 'lifecycle':
        if (event.phase === 'completed') log.outro(event.message);
        return;
      case 'spinner': {
        let spinner = spinners.get(runId);
        if (!spinner) {
          spinner = log.spinner();
          spinners.set(runId, spinner);
        }
        spinner[event.action](event.message);
        return;
      }
      case 'log':
        log.log[event.level](event.message);
        return;
      case 'status':
        log.pushStatus(event.message);
        return;
      case 'tasks':
        log.syncTodos(event.tasks);
        return;
      case 'authError':
        log.showAuthError(event.detail);
        return;
      // The session store keeps the run state, the TUI draws the display, no host reads the binding.
      case 'stage':
      case 'url':
      case 'usage':
      case 'finalCost':
      case 'handoff':
      case 'completion':
      case 'activity':
      case 'binding':
        return;
      default: {
        const unhandled: never = event;
        log.log.warn(`Unhandled progress: ${JSON.stringify(unhandled)}`);
      }
    }
  };
}
