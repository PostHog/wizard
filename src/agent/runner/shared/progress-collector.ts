/**
 * The agent's own record of what it reported.
 *
 * `runAgent` accumulates its final `RunSnapshot` here, independently of any
 * observer, so a missing or throwing `onProgress` never makes the result
 * incomplete. The emitter wraps the caller's callback: it applies the event
 * here first, then hands a copy to the observer, and logs rather than
 * propagates anything the observer throws.
 */

import { logToFile } from '@utils/debug';
import { appendStatus } from '@shared/status-history';
import type {
  AgentProgress,
  ProgressEmitter,
  SpinnerHandle,
} from '@agent/progress';
import type { RunSnapshot } from './types';

export interface ProgressCollector {
  emit: ProgressEmitter;
  snapshot(): RunSnapshot;
}

export function createProgressCollector(
  onProgress?: (event: AgentProgress) => unknown,
): ProgressCollector {
  const snapshot: RunSnapshot = {
    tasks: [],
    statusMessages: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    },
  };

  const apply = (event: AgentProgress): void => {
    switch (event.kind) {
      case 'tasks':
        snapshot.tasks = event.tasks.map((t) => ({ ...t }));
        break;
      case 'status':
        snapshot.statusMessages = appendStatus(
          snapshot.statusMessages,
          event.message,
        );
        break;
      case 'stage':
        snapshot.stage = event.stage;
        break;
      case 'url':
        if (event.which === 'dashboard') snapshot.dashboardUrl = event.url;
        else snapshot.notebookUrl = event.url;
        break;
      case 'usage':
        snapshot.usage.inputTokens += event.delta.inputTokens;
        snapshot.usage.outputTokens += event.delta.outputTokens;
        snapshot.usage.cacheReadTokens += event.delta.cacheReadTokens;
        snapshot.usage.cacheCreationTokens += event.delta.cacheCreationTokens;
        break;
      case 'finalCost':
        snapshot.finalCostUsd = event.usd;
        break;
      case 'handoff':
        snapshot.handoffText = event.text;
        break;
      default:
        break;
    }
  };

  const emit: ProgressEmitter = (event) => {
    apply(event);
    if (!onProgress) return;
    try {
      const observed = onProgress(structuredClone(event));
      if (
        observed &&
        typeof (observed as PromiseLike<unknown>).then === 'function'
      ) {
        void Promise.resolve(observed).catch((error: unknown) => {
          try {
            logToFile(
              `[agent] progress observer rejected on ${event.kind}:`,
              error,
            );
          } catch {
            // Logging is best effort.
          }
        });
      }
    } catch (error) {
      // A broken projection is the host's problem, not the run's. Say so in
      // the log and carry on; the snapshot above is the source of truth.
      try {
        logToFile(
          `[agent] progress observer threw on ${event.kind}:`,
          error instanceof Error ? error.message : error,
        );
      } catch {
        // Logging is best effort.
      }
    }
  };

  return {
    emit,
    snapshot: () => ({
      ...snapshot,
      tasks: snapshot.tasks.map((t) => ({ ...t })),
      statusMessages: [...snapshot.statusMessages],
      usage: { ...snapshot.usage },
    }),
  };
}

/** The run spinner as a progress emitter. One per run, like `getUI().spinner()`. */
export function createEmitSpinner(emit: ProgressEmitter): SpinnerHandle {
  return {
    start: (message) => emit({ kind: 'spinner', action: 'start', message }),
    stop: (message) => emit({ kind: 'spinner', action: 'stop', message }),
    message: (message) => emit({ kind: 'spinner', action: 'message', message }),
  };
}

/** `WizardUI.log` as a progress emitter. */
export function createEmitLog(emit: ProgressEmitter): {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  success(message: string): void;
  step(message: string): void;
} {
  return {
    info: (message) => emit({ kind: 'log', level: 'info', message }),
    warn: (message) => emit({ kind: 'log', level: 'warn', message }),
    error: (message) => emit({ kind: 'log', level: 'error', message }),
    success: (message) => emit({ kind: 'log', level: 'success', message }),
    step: (message) => emit({ kind: 'log', level: 'step', message }),
  };
}
