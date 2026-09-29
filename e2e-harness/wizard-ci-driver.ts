/**
 * WizardCiDriver — the read/act control plane over a live TUI's control target.
 *
 * This is the read/act core both e2e routes drive. A test harness or a driver
 * LLM uses these primitives to run a real wizard end-to-end without keystrokes:
 *
 *   readState()      — the target's projection of the committed store state
 *                      (the same state the Ink render is a pure function of),
 *                      reshaped for the harness, plus whether an overlay is up.
 *   listActions()    — the commit actions legal on the current screen.
 *   performAction()  — invoke one, through the same store commit the Ink
 *                      screen's keyboard handler makes, and return the next state.
 *
 * It observes *committed* state and actuates *commits*. In-progress keystroke
 * state (typed-but-unsubmitted text, highlighted option, the wizard_ask
 * per-question accumulator) is React-local and deliberately invisible here —
 * the driver issues the final commit directly instead.
 */

import { Overlay } from '@tui';
import type { PendingQuestion, TaskNotice } from '@agent/types';
import type { ActionView, ControlTarget } from '@shared/control/types';
import type { RunPhase } from '@shared/run-state';

export type { ActionView };

/** A setup question projected for the harness (no `detect` fn, no closures). */
export interface SetupQuestionView {
  key: string;
  message: string;
  options: Array<{ label: string; value: string; hint?: string }>;
}

/**
 * A task notice projected for the harness. Title, items and prompt only — the
 * decision function needs to know a notice is up and what it covers, not the
 * full body copy the screen renders.
 */
export interface TaskNoticeView {
  title: string;
  items: string[];
  prompt: string;
}

/**
 * The serialized observable state. A whitelist of the session — credentials
 * are reduced to a flag so secrets never reach a driver LLM.
 */
export interface CiState {
  currentScreen: string;
  hasOverlay: boolean;
  runPhase: RunPhase;
  session: {
    installDir: string;
    integration: string | null;
    detectedFrameworkLabel: string | null;
    detectionComplete: boolean;
    setupConfirmed: boolean;
    /** Self-driving integration-check answer; null until decided. */
    integrate: boolean | null;
    hasCredentials: boolean;
    projectId: number | null;
    mcpComplete: boolean;
    slackStepDismissed: boolean;
    skillsComplete: boolean;
    outroDismissed: boolean;
    discoveredFeatures: string[];
  };
  tasks: Array<{ label: string; status: string }>;
  statusMessages: string[];
  eventPlan: Array<{ name: string; description: string }>;
  /** Present iff a wizard_ask overlay is up. */
  pendingQuestion: PendingQuestion | null;
  /** Present iff a task-notice overlay is up. */
  taskNotice: TaskNoticeView | null;
  /** Unresolved framework-setup questions when on the setup screen. */
  setupQuestions: SetupQuestionView[];
  /** Commit actions legal on currentScreen. */
  actions: ActionView[];
}

/** The projected session fields the driver reads. */
type ProjectedSession = CiState['session'] & {
  runPhase: RunPhase;
  pendingQuestion?: PendingQuestion | null;
  taskNotice?: TaskNotice | null;
};

const OVERLAYS: ReadonlySet<string> = new Set(Object.values(Overlay));

export class UnknownActionError extends Error {
  constructor(action: string, screen: string) {
    super(
      `No action "${action}" on screen "${screen}". ` +
        `Call list_actions / read read_state.actions first.`,
    );
    this.name = 'UnknownActionError';
  }
}

export class WizardCiDriver {
  constructor(private readonly target: ControlTarget) {}

  /** Snapshot the committed state as the harness reads it. */
  readState(): CiState {
    const state = this.target.readState();
    const s = state.session as ProjectedSession;
    const screen = state.currentScreen ?? '';
    return {
      currentScreen: screen,
      hasOverlay: OVERLAYS.has(screen),
      runPhase: s.runPhase,
      session: {
        installDir: s.installDir,
        integration: s.integration,
        detectedFrameworkLabel: s.detectedFrameworkLabel,
        detectionComplete: s.detectionComplete,
        setupConfirmed: s.setupConfirmed,
        integrate: s.integrate,
        hasCredentials: s.hasCredentials,
        projectId: s.projectId,
        mcpComplete: s.mcpComplete,
        slackStepDismissed: s.slackStepDismissed,
        skillsComplete: s.skillsComplete,
        outroDismissed: s.outroDismissed,
        discoveredFeatures: [...s.discoveredFeatures],
      },
      tasks: state.tasks.map((t) => ({ label: t.label, status: t.status })),
      statusMessages: [...state.statusMessages],
      eventPlan: state.eventPlan.map((e) => ({
        name: e.name,
        description: e.description,
      })),
      pendingQuestion: s.pendingQuestion ?? null,
      taskNotice: s.taskNotice
        ? {
            title: s.taskNotice.title,
            items: [...(s.taskNotice.items ?? [])],
            prompt: s.taskNotice.prompt,
          }
        : null,
      setupQuestions: state.setupQuestions.map((q) => ({
        key: q.key,
        message: q.message,
        options: q.options.map((o: SetupQuestionView['options'][number]) => ({
          label: o.label,
          value: o.value,
          ...(o.hint ? { hint: o.hint } : {}),
        })),
      })),
      actions: this.listActions(),
    };
  }

  /** Exposed through read_state.actions; there is no list_actions MCP tool. */
  listActions(): ActionView[] {
    return this.target.actions().map((a) => ({
      id: a.id,
      description: a.description,
      ...(a.params ? { params: a.params } : {}),
    }));
  }

  /**
   * Apply a named action, then return the next state. Throws
   * UnknownActionError if the action isn't legal on the current screen,
   * MissingParamError if a required param is absent, or BadParamError if a
   * param is unusable.
   */
  performAction(
    actionId: string,
    params: Record<string, unknown> = {},
  ): CiState {
    const action = this.target.actions().find((a) => a.id === actionId);
    if (!action) {
      throw new UnknownActionError(
        actionId,
        this.target.readState().currentScreen ?? '',
      );
    }
    action.apply(params); // may throw a param error
    return this.readState();
  }

  /**
   * Resolve once the rendered screen changes (or a wizard_ask overlay opens),
   * or after timeoutMs. Lets a driver loop block on the next decision point
   * instead of polling — the store fires its listener on every commit,
   * including the agent's UI calls.
   */
  waitForChange(timeoutMs = 120_000): Promise<CiState> {
    const screen = () => this.target.readState().currentScreen;
    const before = screen();
    return new Promise<CiState>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsub();
        resolve(this.readState());
      };
      const timer = setTimeout(finish, timeoutMs);
      const unsub = this.target.subscribe(() => {
        if (screen() !== before) finish();
      });
    });
  }
}
