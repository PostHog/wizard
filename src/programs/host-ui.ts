import type {
  AgentInteraction,
  AgentProgress,
  AskAnswers,
  AuthErrorDetail,
  OutroData,
  PendingQuestion,
  SpinnerHandle,
  TaskNotice,
  TokenUsageDelta,
} from '@agent/types';
import { logToFile } from '@utils/debug';

/** What a host UI renders from a run's progress, one method per progress event. */
export interface ProgressUi {
  /** Success outro with a plain text message. */
  outro(message: string): void;
  log: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    success(message: string): void;
    step(message: string): void;
  };
  pushStatus(message: string): void;
  spinner(): SpinnerHandle;
  /** Signal that the main work (agent run) has started. */
  startRun(): void;
  /** Show auth error overlay when Anthropic API returns 401. */
  showAuthError(detail?: AuthErrorDetail): void;
  // Receives the full materialised task list each call. The caller (agent
  // loop) maintains a Map<taskId, …> from incremental Task* events and
  // re-emits the snapshot here, preserving the existing store semantics.
  syncTodos(
    todos: Array<{ content: string; status: string; activeForm?: string }>,
  ): void;
  setDashboardUrl(url: string): void;
  /** Current "stage of work" — derived from the active tool call. Drives the
   *  Visualizer tab's NOW PLAYING display. Pass an AgentPhase value. */
  setStage(stage: string): void;
  setNotebookUrl(url: string): void;
  /** Handoff doc from the `publish_handoff` tool; the task-stream push carries it as `handoff_text`. */
  setHandoffText(text: string): void;
  /** Accumulate one assistant turn's token usage into the hidden Ctrl+T
   *  token/cost HUD's running estimate. No-op outside the TUI. */
  addTokenUsage(delta: TokenUsageDelta): void;
  /** Reconcile the HUD's running cost estimate to the SDK's authoritative
   *  `total_cost_usd` once the agent run completes. No-op outside the TUI. */
  setFinalTokenCostUsd(costUsd: number): void;
  // Replaces the direct `session.outroData = X` mutation that breaks once
  // setKey-based store mutations have forked the session reference.
  setOutroData(data: OutroData): void;
}

/** How a host UI answers the agent's questions and task notices. */
export interface InteractionUi {
  /**
   * Show an optional step's notice and return whether to keep that step. Hosts
   * that cannot prompt resolve false: a step nobody can answer must not run.
   */
  showTaskNotice(notice: TaskNotice): Promise<boolean>;
  /**
   * Dismiss an in-flight task notice as declined. Called when the offer times
   * out: the notice sits in front of the run's final steps, so left unanswered
   * it would hold the report behind a modal nobody is looking at.
   */
  cancelTaskNotice(): void;
  /**
   * Open the wizard_ask overlay and resolve with the user's answers.
   * Implementations that can't ask (CI/logging) reject so the bridge can
   * surface a clear "not available" error to the agent.
   */
  requestQuestion(question: PendingQuestion): Promise<AskAnswers>;
  /**
   * Dismiss the in-flight wizard_ask overlay, resolving its request with
   * cancelled sentinels. No-op when nothing is pending. The ask bridge calls
   * this on timeout so a stale pending question can't block later asks.
   */
  cancelPendingQuestion(): void;
}

// ── Progress → host UI, one call per event ────────────────────────────

/**
 * The inverse of the agent's former `getUI()` calls: one event, one
 * host UI method, synchronous, in emission order. Because each case maps
 * back to exactly the call the agent used to make, the frame and flow goldens
 * hold without regeneration.
 */
export function createUiReducer(
  ui: ProgressUi,
): (event: AgentProgress) => void {
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
      case 'activity':
        // Step lines belong to the caller that asked for them, not the run UI.
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

/** The agent's questions, answered by the host UI. */
export function uiInteraction(ui: InteractionUi): AgentInteraction {
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
      logToFile('[host-ui] dismissing an aborted request failed', error);
    }
  };
  // An abort listener added to an already aborted signal never fires.
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, { once: true });
  return open.finally(() => signal.removeEventListener('abort', onAbort));
}
