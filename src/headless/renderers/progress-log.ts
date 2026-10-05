/** A run's progress as log lines: one `LoggingUI` call per event that has something to print. */
import type { SpinnerHandle } from '@agent/types';
import type { ProgramProgress } from '@programs/types';
import type { LoggingUI } from './logging-ui';

export function logProgress(
  log: LoggingUI,
): (progress: ProgramProgress) => void {
  let spinner: SpinnerHandle | undefined;
  return ({ event }) => {
    switch (event.kind) {
      case 'lifecycle':
        if (event.phase === 'completed') log.outro(event.message);
        return;
      case 'spinner': {
        const handle = (spinner ??= log.spinner());
        handle[event.action](event.message);
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
      case 'stage':
      case 'url':
      case 'usage':
      case 'finalCost':
      case 'handoff':
      case 'completion':
      case 'binding':
        return;
      case 'activity':
        // Step lines belong to the caller that asked for them, not the run UI.
        return;
      default: {
        const unhandled: never = event;
        throw new Error(
          `Unhandled agent progress: ${JSON.stringify(unhandled)}`,
        );
      }
    }
  };
}
