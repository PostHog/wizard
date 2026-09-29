import type { AgentProgress, OutroData } from '@agent/types';
import type { ProgramProgress } from '@programs/types';
import { OutroKind } from '@shared/outro';
import { RunPhase } from '@shared/run-state';
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
  return (event) => {
    switch (event.kind) {
      case 'lifecycle':
        if (event.phase === 'started') store.setRunPhase(RunPhase.Running);
        else completeRun(store, event.message);
        break;
      case 'spinner':
      case 'log':
      case 'stage':
      case 'usage':
      case 'finalCost':
      case 'authError':
        showDisplayEvent(store, event);
        break;
      case 'status':
        store.pushStatus(event.message);
        break;
      case 'tasks':
        store.syncTodos(event.tasks);
        break;
      case 'url':
        if (event.which === 'dashboard') store.setDashboardUrl(event.url);
        else store.setNotebookUrl(event.url);
        break;
      case 'handoff':
        store.setHandoffText(event.text);
        break;
      case 'completion':
        setCompletionOutro(store, event.outro);
        break;
      case 'activity':
        // Step lines belong to the caller that asked for them, not the run UI.
        break;
      case 'binding':
        // The resolved binding is not stored or shown; no host reads it.
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

/** A scan's success: its last line, a plain success outro when none was set, and the run phase to Completed. */
function completeRun(store: WizardStore, message: string): void {
  store.pushStatus(stripAnsi(message));
  if (!store.session.outroData) {
    store.setOutroData({
      kind: OutroKind.Success,
      message: stripAnsi(message),
    });
  }
  if (store.session.runPhase === RunPhase.Running) {
    store.setRunPhase(RunPhase.Completed);
  }
}

/** The scan's outro, with the URLs the agent emitted winning over the program's fallbacks. */
function setCompletionOutro(store: WizardStore, outro: OutroData): void {
  const live = store.session;
  store.setOutroData({
    ...outro,
    dashboardUrl: live.dashboardUrl ?? outro.dashboardUrl ?? undefined,
    notebookUrl: live.notebookUrl ?? outro.notebookUrl ?? undefined,
  });
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}
