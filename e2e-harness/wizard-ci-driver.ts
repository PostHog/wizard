/**
 * WizardCiDriver — the read/act control plane over a live WizardStore.
 *
 * This is the SDK-free core of wizard-ci-tools. A test harness or a driver LLM
 * uses three primitives to run a real wizard end-to-end without a terminal:
 *
 *   readState()      — a truthful projection of the committed store state
 *                      (the same state the Ink render is a pure function of),
 *                      plus the derived currentScreen/hasOverlay so the snapshot
 *                      is complete without reaching into router internals.
 *   listActions()    — the commit actions legal on the current screen.
 *   performAction()  — invoke one, via the exact store setter the Ink screen's
 *                      keyboard handler would call, and return the next state.
 *
 * It observes *committed* state and actuates *commits*. In-progress keystroke
 * state (typed-but-unsubmitted text, highlighted option, the wizard_ask
 * per-question accumulator) is React-local and deliberately invisible here —
 * the driver issues the final commit directly instead.
 */

import type { WizardStore } from '@ui/tui/store';
import type { ScreenName } from '@ui/tui/router';
import type { PendingQuestion, RunPhase } from '@lib/wizard-session';
import { actionsForScreen, MissingParamError } from './action-registry.js';

/** A setup question projected for the harness (no `detect` fn, no closures). */
export interface SetupQuestionView {
  key: string;
  message: string;
  options: Array<{ label: string; value: string; hint?: string }>;
}

/** The action surface as seen by a caller (no `apply` closure). */
export interface ActionView {
  id: string;
  description: string;
  params?: Record<string, string>;
}

/**
 * The serialized observable state. A whitelist of WizardSession — credentials
 * are reduced to a boolean so secrets never reach a driver LLM.
 */
export interface CiState {
  currentScreen: ScreenName;
  hasOverlay: boolean;
  runPhase: RunPhase;
  session: {
    installDir: string;
    integration: string | null;
    detectedFrameworkLabel: string | null;
    detectionComplete: boolean;
    setupConfirmed: boolean;
    hasCredentials: boolean;
    projectId: number | null;
    mcpComplete: boolean;
    slackStepDismissed: boolean;
    skillsComplete: boolean;
    outroDismissed: boolean;
    llmOptIn: boolean;
    discoveredFeatures: string[];
  };
  tasks: Array<{ label: string; status: string; activeForm?: string }>;
  statusMessages: string[];
  eventPlan: Array<{ name: string; description: string }>;
  /** Present iff a wizard_ask overlay is up. */
  pendingQuestion: PendingQuestion | null;
  /** Unresolved framework-setup questions when on the setup screen. */
  setupQuestions: SetupQuestionView[];
  /** Commit actions legal on currentScreen. */
  actions: ActionView[];
}

export class UnknownActionError extends Error {
  constructor(action: string, screen: ScreenName) {
    super(
      `No action "${action}" on screen "${screen}". ` +
        `Call list_actions / read read_state.actions first.`,
    );
    this.name = 'UnknownActionError';
  }
}

export class WizardCiDriver {
  constructor(private readonly store: WizardStore) {}

  /** Snapshot the committed state plus the derived screen. */
  readState(): CiState {
    const s = this.store.session;
    const screen = this.store.currentScreen;
    return {
      currentScreen: screen,
      hasOverlay: this.store.router.hasOverlay,
      runPhase: s.runPhase,
      session: {
        installDir: s.installDir,
        integration: s.integration,
        detectedFrameworkLabel: s.detectedFrameworkLabel,
        detectionComplete: s.detectionComplete,
        setupConfirmed: s.setupConfirmed,
        hasCredentials: s.credentials !== null,
        projectId: s.credentials?.projectId ?? null,
        mcpComplete: s.mcpComplete,
        slackStepDismissed: s.slackStepDismissed,
        skillsComplete: s.skillsComplete,
        outroDismissed: s.outroDismissed,
        llmOptIn: s.llmOptIn,
        discoveredFeatures: [...s.discoveredFeatures],
      },
      tasks: this.store.tasks.map((t) => ({
        label: t.label,
        status: t.status,
        activeForm: t.activeForm,
      })),
      statusMessages: [...this.store.statusMessages],
      eventPlan: this.store.eventPlan.map((e) => ({
        name: e.name,
        description: e.description,
      })),
      pendingQuestion: s.pendingQuestion ?? null,
      setupQuestions: this.unresolvedSetupQuestions(),
      actions: this.listActions(),
    };
  }

  /** Commit actions legal on the current screen. */
  listActions(): ActionView[] {
    return actionsForScreen(this.store.currentScreen).map((a) => ({
      id: a.id,
      description: a.description,
      ...(a.params ? { params: a.params } : {}),
    }));
  }

  /**
   * Apply a named action via its store setter, then return the next state.
   * Throws UnknownActionError if the action isn't legal on the current screen,
   * or MissingParamError if a required param is absent.
   */
  performAction(
    actionId: string,
    params: Record<string, unknown> = {},
  ): CiState {
    const screen = this.store.currentScreen;
    const action = actionsForScreen(screen).find((a) => a.id === actionId);
    if (!action) throw new UnknownActionError(actionId, screen);
    action.apply(this.store, params); // may throw MissingParamError
    return this.readState();
  }

  /**
   * Resolve once the rendered screen changes (or a wizard_ask overlay opens),
   * or after timeoutMs. Lets a driver loop block on the next decision point
   * instead of polling — the store fires its version listener on every commit,
   * including the agent's getUI() calls.
   */
  waitForChange(timeoutMs = 120_000): Promise<CiState> {
    const before = this.store.currentScreen;
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
      const unsub = this.store.subscribe(() => {
        if (this.store.currentScreen !== before) finish();
      });
    });
  }

  private unresolvedSetupQuestions(): SetupQuestionView[] {
    const s = this.store.session;
    const questions = s.frameworkConfig?.metadata.setup?.questions ?? [];
    return questions
      .filter((q) => !(q.key in s.frameworkContext))
      .map((q) => ({
        key: q.key,
        message: q.message,
        options: q.options.map((o) => ({
          label: o.label,
          value: o.value,
          ...(o.hint ? { hint: o.hint } : {}),
        })),
      }));
  }
}

export { MissingParamError };
