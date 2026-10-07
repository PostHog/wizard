import type { AgentProgress } from '@agent/types';
import type { ProgramProgress } from '@programs/types';
import { applyAgentProgress } from '@programs';
import type { WizardStore } from './store.js';

// ── Progress → the store, one write per event ─────────────────────────

/**
 * A scan's progress on the store: one event, one write, synchronous, in
 * emission order. For a scan a screen runs itself; a `runProgram` run already
 * writes its run state to the session store, so its progress goes through
 * `displayProgress`.
 */
export function scanProgress(
  store: WizardStore,
): (event: AgentProgress) => void {
  const show = displayProgress(store);
  return (event) => {
    // The success line is shown and set as the fallback outro without escape codes.
    const clean =
      event.kind === 'lifecycle' && event.phase === 'completed'
        ? { ...event, message: stripAnsi(event.message) }
        : event;
    show({ runId: 'scan', event: clean });
    applyAgentProgress(store.sessions, clean);
  };
}

/** A `runProgram` run's progress on what only the TUI shows; the run state is already in the session store. */
export function displayProgress(
  store: WizardStore,
): (progress: ProgramProgress) => void {
  return ({ event }) => {
    switch (event.kind) {
      case 'lifecycle':
        if (event.phase === 'completed')
          store.pushStatus(stripAnsi(event.message));
        return;
      case 'spinner':
      case 'log':
      case 'stage':
      case 'usage':
      case 'finalCost':
      case 'authError':
        showDisplayEvent(store, event);
        return;
      // Run state runProgram records, or nothing to show.
      case 'status':
      case 'tasks':
      case 'url':
      case 'handoff':
      case 'completion':
      case 'activity':
      case 'binding':
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

type DisplayEvent = Extract<
  AgentProgress,
  { kind: 'spinner' | 'log' | 'stage' | 'usage' | 'finalCost' | 'authError' }
>;

/** The events both feeds show the same way: lines on the status feed, the stage, the token HUD, the auth overlay. */
function showDisplayEvent(store: WizardStore, event: DisplayEvent): void {
  switch (event.kind) {
    case 'spinner':
      if (event.message) store.pushStatus(event.message);
      return;
    case 'log':
      store.pushStatus(event.message);
      return;
    case 'stage':
      store.setCurrentStage(event.stage);
      return;
    case 'usage':
      store.addTokenUsage(event.delta);
      return;
    case 'finalCost':
      store.setFinalTokenCostUsd(event.usd);
      return;
    case 'authError':
      store.showAuthError(event.detail);
      return;
  }
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}
