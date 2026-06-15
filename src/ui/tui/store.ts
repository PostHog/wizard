/**
 * WizardStore — Nanostore-backed reactive store for the TUI.
 * React components subscribe via useSyncExternalStore.
 *
 * The active screen is derived from session state — WizardRouter walks
 * the flow and shows the first step whose `isComplete` is still false.
 *
 * Define a step `gate` if your screen needs to await user interactions.
 * bin.ts calls `await store.getGate(stepId)` to pause until the gate
 * predicate becomes true.
 *
 * All session mutations that affect screen resolution go through
 * explicit setters so emitChange() is always called.
 */

import { atom, map } from 'nanostores';
import { logToFile } from '@utils/debug';
import { TaskStatus, isTaskStatus, type AuthErrorDetail } from '@ui/wizard-ui';
import {
  type WizardSession,
  type OutroData,
  type DiscoveredFeature,
  type PendingQuestion,
  type AskAnswers,
  AdditionalFeature,
  McpOutcome,
  RunPhase,
  buildSession,
} from '@lib/wizard-session';
import type { SettingsConflict } from '@lib/agent/claude-settings';
import {
  describeDisruption,
  type WizardReadinessResult,
} from '@lib/health-checks/readiness';
import {
  WizardRouter,
  type ScreenName,
  ScreenId,
  Overlay,
  Program,
  type ProgramId,
} from './router.js';
import { analytics, sessionProperties } from '@utils/analytics';
import type {
  StoreInitContext,
  ProgramReadyContext,
} from '@lib/programs/program-step';
import { getProgramConfig } from '@lib/programs/program-registry';
import { withAiOptInGate } from '@lib/programs/ai-opt-in-gate';
import { EXPANDED_COUNT } from '@ui/tui/constants';

export { TaskStatus, ScreenId, Overlay, Program, RunPhase, McpOutcome };
export type { ScreenName, OutroData, WizardSession, ProgramId };

export interface TaskItem {
  label: string;
  activeForm?: string;
  status: TaskStatus;
  /** Legacy compat */
  done: boolean;
}

export interface PlannedEvent {
  name: string;
  description: string;
}

interface GateEntry {
  predicate: (session: WizardSession) => boolean;
  promise: Promise<void>;
  resolve: () => void;
  resolved: boolean;
}

/**
 * FIFO cap on retained status lines. The status bar is the only consumer and
 * renders at most EXPANDED_COUNT lines, so there is no reason to retain more —
 * the cap is tied to the window it feeds.
 */
const MAX_STATUS_MESSAGES = EXPANDED_COUNT;

export class WizardStore {
  // ── Internal nanostore atoms ─────────────────────────────────────
  private $session = map<WizardSession>(buildSession({}));
  private $statusMessages = atom<string[]>([]);
  private $statusExpanded = atom(false);
  private $tasks = atom<TaskItem[]>([]);
  private $eventPlan = atom<PlannedEvent[]>([]);
  private $learnCardBlockIdx = atom(0);
  private $learnCardComplete = atom(false);
  private $version = atom(0);

  private _onTasksChanged: (() => void) | null = null;
  /** Last screen seen — used to detect screen transitions for analytics. */
  private _lastScreen: ScreenName | null = null;

  /** Hooks run when transitioning onto a screen. */
  private _enterScreenHooks = new Map<ScreenName, (() => void)[]>();

  /** Gate promises derived from program step definitions. */
  private _gates = new Map<string, GateEntry>();

  version = '';

  /** Navigation router — resolves active screen from session state. */
  readonly router: WizardRouter;

  /** Blocks agent execution until the settings-override overlay is dismissed. */
  private _resolveSettingsOverride: (() => void) | null = null;
  private _backupAndFixSettings: (() => boolean) | null = null;

  /** Blocks OAuth flow until the port-conflict overlay is dismissed. */
  private _resolvePortConflict: (() => void) | null = null;

  /** Resolves the OAuth flow with a manually-entered authorization code. */
  private _resolveManualAuthCode: ((code: string) => void) | null = null;

  /** Resolves the in-flight wizard_ask request. */
  private _resolvePendingQuestion: ((answers: AskAnswers) => void) | null =
    null;

  constructor(program: ProgramId = Program.PostHogIntegration) {
    this.router = new WizardRouter(program);
    this._initFromProgram(program);
  }

  /**
   * Scan program steps for gate predicates and create gate promises.
   *
   * Steps are wrapped with withAiOptInGate so the injected ai-opt-in
   * step's gate registers here — the agent runner awaits it (via
   * WizardUI.waitForAiOptIn) before any source leaves the machine.
   * Same wrapper screen-sequences.ts uses, so the gate and its screen
   * can't drift apart.
   */
  private _initFromProgram(program: ProgramId): void {
    const steps = withAiOptInGate(getProgramConfig(program));

    // Create gate promises from steps that define them
    for (const step of steps) {
      if (step.gate) {
        let resolve!: () => void;
        const promise = new Promise<void>((r) => {
          resolve = r;
        });
        this._gates.set(step.id, {
          predicate: step.gate,
          promise,
          resolve,
          resolved: false,
        });
      }
    }
  }

  /**
   * Run the program steps' onInit callbacks. startTUI calls this once
   * the screens are actually rendering — constructing a store alone
   * (tests, playground) must not fire init work like the health-check
   * pre-flight, whose probes belong only to flows that show its screen.
   */
  runInitHooks(): void {
    const steps = getProgramConfig(this.router.activeProgram).steps;
    const getSession = (): WizardSession => this.session;
    const ctx: StoreInitContext = {
      get session() {
        return getSession();
      },
      setReadinessResult: (r) => this.setReadinessResult(r),
      setFrameworkContext: (k, v) => this.setFrameworkContext(k, v),
      emitChange: () => this.emitChange(),
    };
    for (const step of steps) {
      step.onInit?.(ctx);
    }
  }

  /**
   * Run all `onReady` hooks declared by the current flow's steps, in
   * order. Must be called after `store.session = session` so hooks see
   * the real installDir. bin.ts calls this generically — it doesn't
   * need to know which program has which pre-flow work.
   */
  async runReadyHooks(): Promise<void> {
    const steps = getProgramConfig(this.router.activeProgram).steps;
    const ctx: ProgramReadyContext = {
      session: this.session,
      setFrameworkContext: (k, v) => this.setFrameworkContext(k, v),
      setFrameworkConfig: (i, c) => this.setFrameworkConfig(i, c),
      setDetectedFramework: (l) => this.setDetectedFramework(l),
      setSkillId: (id) => this.setSkillId(id),
      setUnsupportedVersion: (info) => this.setUnsupportedVersion(info),
      addDiscoveredFeature: (f) => this.addDiscoveredFeature(f),
      setDetectionComplete: () => this.setDetectionComplete(),
    };
    for (const step of steps) {
      if (step.onReady) {
        await step.onReady(ctx);
      }
    }
  }

  // ── Gate API ────────────────────────────────────────────────────

  /**
   * Get a gate promise by step ID — the primary blocking checkpoint API
   * for bin.ts. `await store.getGate('...')` parks the caller until the
   * corresponding program step's gate predicate flips to true (if the
   * predicate stays false, the caller stays parked indefinitely — the
   * TUI keeps rendering so the user can resolve whatever is blocking).
   *
   * If the program doesn't define a step with this ID, or the step
   * has no `gate` predicate, this returns an already-resolved promise
   * so bin.ts flows straight through. This lets programs opt in to
   * gates on a per-step basis without bin.ts needing to know which
   * gates exist in which flow.
   */
  getGate(stepId: string): Promise<void> {
    return this._gates.get(stepId)?.promise ?? Promise.resolve();
  }

  /**
   * Re-evaluate every gate predicate against the current session and
   * resolve any whose predicate now returns true. Called after every
   * emitChange(), so gates unblock as soon as the session mutation
   * that satisfies them lands. Gates only resolve once — a predicate
   * that goes true → false → true will NOT re-block a caller that
   * already awaited through.
   */
  private _checkGates(): void {
    for (const [, gate] of this._gates) {
      if (!gate.resolved && gate.predicate(this.session)) {
        gate.resolved = true;
        gate.resolve();
      }
    }
  }

  // ── State accessors (read from atoms) ────────────────────────────

  get session(): WizardSession {
    return this.$session.get();
  }

  set session(value: WizardSession) {
    this.$session.set(value);
    this.emitChange();
  }

  get statusMessages(): string[] {
    return this.$statusMessages.get();
  }

  get tasks(): TaskItem[] {
    return this.$tasks.get();
  }

  get eventPlan(): PlannedEvent[] {
    return this.$eventPlan.get();
  }

  get statusExpanded(): boolean {
    return this.$statusExpanded.get();
  }

  toggleStatusExpanded(): void {
    this.$statusExpanded.set(!this.$statusExpanded.get());
    this.emitChange();
  }

  setStatusExpanded(expanded: boolean): void {
    if (this.$statusExpanded.get() !== expanded) {
      this.$statusExpanded.set(expanded);
      this.emitChange();
    }
  }

  // ── Session setters ─────────────────────────────────────────────
  // Every setter that affects screen resolution calls emitChange().
  // Business logic calls these instead of mutating session directly.

  /** Sets setupConfirmed. Gate resolves via _checkGates(). */
  completeSetup(): void {
    this.$session.setKey('setupConfirmed', true);
    analytics.wizardCapture('setup confirmed', sessionProperties(this.session));
    this.emitChange();
  }

  setRunPhase(phase: RunPhase): void {
    this.$session.setKey('runPhase', phase);
    this.emitChange();
  }

  setCredentials(credentials: WizardSession['credentials']): void {
    this.$session.setKey('credentials', credentials);
    analytics.wizardCapture('auth complete', {
      project_id: credentials?.projectId,
    });
    this.emitChange();
  }

  setRoleAtOrganization(role: string | null): void {
    this.$session.setKey('roleAtOrganization', role);
    this.emitChange();
  }

  setApiUser(user: WizardSession['apiUser']): void {
    this.$session.setKey('apiUser', user);
    this.emitChange();
  }

  setFrameworkConfig(
    integration: WizardSession['integration'],
    config: WizardSession['frameworkConfig'],
  ): void {
    this.$session.setKey('integration', integration);
    this.$session.setKey('frameworkConfig', config);
    this.$session.setKey('unsupportedVersion', null);
    this.emitChange();
  }

  setDetectionComplete(): void {
    this.$session.setKey('detectionComplete', true);
    this.emitChange();
  }

  setDetectedFramework(label: string): void {
    this.$session.setKey('detectedFrameworkLabel', label);
    this.emitChange();
  }

  setSkillId(skillId: string | null): void {
    this.$session.setKey('skillId', skillId);
    this.emitChange();
  }

  setUnsupportedVersion(info: {
    current: string;
    minimum: string;
    docsUrl: string;
  }): void {
    this.$session.setKey('unsupportedVersion', info);
    this.emitChange();
  }

  setLoginUrl(url: string | null): void {
    this.$session.setKey('loginUrl', url);
    this.emitChange();
  }

  setAuthorizeUrl(url: string | null): void {
    this.$session.setKey('authorizeUrl', url);
    this.emitChange();
  }

  setReadinessResult(result: WizardReadinessResult | null): void {
    this.$session.setKey('readinessResult', result);
    // Fires once per run (setReadinessResult is called once from the
    // health-check step), the moment the disruption screen will appear.
    const disruption = result && describeDisruption(result);
    if (disruption) {
      analytics.wizardCapture('service disruption shown', { ...disruption });
    }
    this.emitChange();
  }

  /** User dismissed the blocking outage screen. Gate resolves via _checkGates(). */
  dismissOutage(): void {
    logToFile('[health-checks] user dismissed outage screen, continuing');
    this.$session.setKey('outageDismissed', true);
    this.emitChange();
  }

  /**
   * Push the settings-override overlay and return a promise that blocks
   * until the user dismisses it via backupAndFixSettingsOverride().
   */
  showSettingsOverride(
    conflicts: SettingsConflict[],
    backupAndFix: () => boolean,
  ): Promise<void> {
    const allKeys = conflicts.flatMap((c) => c.keys);
    this.$session.setKey('settingsOverrideKeys', allKeys);
    this.$session.setKey('settingsConflicts', conflicts);
    this._backupAndFixSettings = backupAndFix;

    const hasReadOnly = conflicts.some((c) => !c.writable);
    if (hasReadOnly) {
      this.pushOverlay(Overlay.ManagedSettings);
    } else {
      this.pushOverlay(Overlay.SettingsOverride);
    }

    return new Promise((resolve) => {
      this._resolveSettingsOverride = resolve;
    });
  }

  /**
   * Push the port-conflict overlay and return a promise that blocks
   * until the user frees the ports and retries, or exits.
   */
  showPortConflict(processInfo: {
    command: string;
    pid: string;
    port: number;
    user: string;
  }): Promise<void> {
    this.$session.setKey('portConflictProcess', processInfo);
    this.pushOverlay(Overlay.PortConflict);
    return new Promise((resolve) => {
      this._resolvePortConflict = resolve;
    });
  }

  /** Dismiss the port-conflict overlay and retry the OAuth port loop. */
  resolvePortConflict(): void {
    this.$session.setKey('portConflictProcess', null);
    this.popOverlay();
    this._resolvePortConflict?.();
    this._resolvePortConflict = null;
  }

  /**
   * Return a promise that resolves when the user submits a manually-entered
   * OAuth code via the paste modal. The OAuth flow races this against the
   * local callback server — see `performOAuthFlow`.
   */
  waitForManualAuthCode(): Promise<string> {
    return new Promise<string>((resolve) => {
      this._resolveManualAuthCode = resolve;
    });
  }

  /** Open the manual OAuth code-entry overlay over the auth screen. */
  showManualAuthCode(): void {
    this.pushOverlay(Overlay.ManualAuthCode);
  }

  /** Dismiss the manual OAuth code overlay without submitting. */
  dismissManualAuthCode(): void {
    this.popOverlay();
  }

  /**
   * Submit a manually-entered authorization code: dismiss the overlay and
   * resolve the in-flight OAuth flow so it can exchange the code for a token.
   */
  submitManualAuthCode(code: string): void {
    this.popOverlay();
    this._resolveManualAuthCode?.(code);
    this._resolveManualAuthCode = null;
  }

  /**
   * Open the WizardAsk overlay with a set of questions and return a promise
   * that resolves once the user submits answers (or the request is cancelled).
   *
   * Only one request is in flight at a time — calling this while a request
   * is already pending throws.
   */
  requestQuestion(question: PendingQuestion): Promise<AskAnswers> {
    if (this._resolvePendingQuestion) {
      throw new Error(
        'requestQuestion called while another wizard_ask request is pending',
      );
    }
    this.$session.setKey('pendingQuestion', question);
    this.pushOverlay(Overlay.WizardAsk);
    analytics.wizardCapture('wizard_ask shown', {
      source: question.source,
      question_count: question.questions.length,
      kinds: question.questions.map((q) => q.kind),
    });
    return new Promise<AskAnswers>((resolve) => {
      this._resolvePendingQuestion = resolve;
    });
  }

  /**
   * Resolve the in-flight wizard_ask request with the user's answers and
   * dismiss the overlay. Answers flow back to the agent as the tool result.
   */
  resolvePendingQuestion(answers: AskAnswers): void {
    const resolve = this._resolvePendingQuestion;
    this._resolvePendingQuestion = null;
    this.$session.setKey('pendingQuestion', null);
    this.popOverlay();
    resolve?.(answers);
  }

  /**
   * Cancel the in-flight wizard_ask request — the bridge sends a sentinel
   * answer ("__cancelled__") so the skill can decide how to handle it.
   */
  cancelPendingQuestion(): void {
    const pending = this.session.pendingQuestion;
    if (!pending) return;
    const cancelled: AskAnswers = {};
    for (const q of pending.questions) {
      cancelled[q.id] = '__cancelled__';
    }
    this.resolvePendingQuestion(cancelled);
  }

  /**
   * Back up .claude/settings.json. Dismisses the overlay on success.
   */
  backupAndFixSettingsOverride(): boolean {
    const ok = this._backupAndFixSettings?.() ?? false;
    if (ok) {
      this.$session.setKey('settingsOverrideKeys', null);
      this.$session.setKey('settingsConflicts', null);
      this.popOverlay();
      this._resolveSettingsOverride?.();
      this._resolveSettingsOverride = null;
      this._backupAndFixSettings = null;
    }
    return ok;
  }

  /** Push the auth-error overlay (no dismiss — user must exit). */
  showAuthError(detail?: AuthErrorDetail): void {
    this.$session.setKey('authErrorDetail', detail ?? null);
    this.pushOverlay(Overlay.AuthError);
  }

  /** Push the session-timeout overlay (no dismiss — user must exit). */
  showSessionTimeout(): void {
    this.pushOverlay(Overlay.SessionTimeout);
  }

  addDiscoveredFeature(feature: DiscoveredFeature): void {
    if (!this.session.discoveredFeatures.includes(feature)) {
      this.session.discoveredFeatures.push(feature);
      this.emitChange();
    }
  }

  /**
   * Enable an additional feature: enqueue it for the stop hook
   * and set any feature-specific session flags.
   */
  enableFeature(feature: AdditionalFeature): void {
    if (!this.session.additionalFeatureQueue.includes(feature)) {
      this.session.additionalFeatureQueue.push(feature);
    }
    // Feature-specific flags
    if (feature === AdditionalFeature.LLM) {
      this.session.llmOptIn = true;
    }
    analytics.wizardCapture('feature enabled', { feature });
    this.emitChange();
  }

  setMcpComplete(
    outcome: McpOutcome = McpOutcome.Skipped,
    installedClients: string[] = [],
    featuresSelected?: 'all' | string[],
  ): void {
    this.$session.setKey('mcpComplete', true);
    this.$session.setKey('mcpOutcome', outcome);
    this.$session.setKey('mcpInstalledClients', installedClients);
    const featuresPayload =
      outcome === McpOutcome.Installed && featuresSelected !== undefined
        ? { mcp_features_selected: featuresSelected }
        : {};
    analytics.wizardCapture('mcp complete', {
      mcp_outcome: outcome,
      mcp_installed_clients: installedClients,
      ...featuresPayload,
      ...sessionProperties(this.session),
    });
    this.emitChange();
  }

  setSkillsComplete(kept: boolean): void {
    this.$session.setKey('skillsComplete', true);
    analytics.wizardCapture('skills complete', {
      skills_kept: kept,
      ...sessionProperties(this.session),
    });
    this.emitChange();
  }

  setMcpSuggestedPromptsDismissed(): void {
    this.$session.setKey('mcpSuggestedPromptsDismissed', true);
    this.emitChange();
  }

  setSlackStepDismissed(): void {
    this.$session.setKey('slackStepDismissed', true);
    this.emitChange();
  }

  setSlackConnected(connected: boolean): void {
    this.$session.setKey('slackConnected', connected);
    this.emitChange();
  }

  setOutroDismissed(): void {
    this.$session.setKey('outroDismissed', true);
    this.emitChange();
  }

  setOutroData(data: OutroData): void {
    this.$session.setKey('outroData', data);
    this.emitChange();
  }

  setDashboardUrl(url: string): void {
    logToFile(`store.setDashboardUrl: ${url}`);
    this.$session.setKey('dashboardUrl', url);
    this.emitChange();
  }

  setNotebookUrl(url: string): void {
    logToFile(`store.setNotebookUrl: ${url}`);
    this.$session.setKey('notebookUrl', url);
    this.emitChange();
  }

  setFrameworkContext(key: string, value: unknown): void {
    const ctx = { ...this.$session.get().frameworkContext, [key]: value };
    this.$session.setKey('frameworkContext', ctx);
    this.emitChange();
  }

  // ── Derived state ───────────────────────────────────────────────

  /**
   * The screen that should be rendered right now.
   * Derived from session state via the router.
   */
  get currentScreen(): ScreenName {
    return this.router.resolve(this.session);
  }

  /** Direction hint for screen transitions. */
  get lastNavDirection(): 'push' | 'pop' | null {
    return this.router.lastNavDirection;
  }

  // ── Change notification ─────────────────────────────────────────

  getVersion(): number {
    return this.$version.get();
  }

  /**
   * Notify React that state has changed.
   * The router re-resolves the active screen on next render.
   * Gate predicates are checked and resolved if ready.
   */
  emitChange(): void {
    this.router._setDirection('push');
    this.$version.set(this.$version.get() + 1);
    this._checkGates();
    this._detectTransition();
  }

  // ── Overlay navigation ──────────────────────────────────────────

  pushOverlay(overlay: Overlay): void {
    this.router._setDirection('push');
    this.router.pushOverlay(overlay);
    this.$version.set(this.$version.get() + 1);
    this._detectTransition();
  }

  popOverlay(): void {
    this.router._setDirection('pop');
    this.router.popOverlay();
    this.$version.set(this.$version.get() + 1);
    this._detectTransition();
  }

  // ── ScreenId transition analytics ─────────────────────────────────

  /**
   * Register a callback to run when transitioning onto the given screen.
   * Fires after every transition that lands on this screen.
   */
  onEnterScreen(screen: ScreenName, fn: () => void): void {
    const list = this._enterScreenHooks.get(screen) ?? [];
    list.push(fn);
    this._enterScreenHooks.set(screen, list);
  }

  /**
   * Detect screen transitions, run enter-screen hooks, and fire analytics.
   * Called at the end of emitChange/pushOverlay/popOverlay.
   */
  private _detectTransition(): void {
    const next = this.router.resolve(this.session);
    const prev = this._lastScreen;
    if (next !== prev) {
      // Every event carries the active TUI screen, filling the
      // "URL / Screen" column in PostHog.
      analytics.setTag('$screen_name', next);
    }
    if (prev !== null && next !== prev) {
      const hooks = this._enterScreenHooks.get(next);
      if (hooks) {
        for (const fn of hooks) fn();
      }
      analytics.wizardCapture(`screen ${next}`, {
        from_screen: prev,
        program_id: this.router.activeProgram,
        ...sessionProperties(this.session),
      });
    }
    this._lastScreen = next;
  }

  // ── Agent observation state ─────────────────────────────────────

  pushStatus(message: string): void {
    const msgs = this.$statusMessages.get();
    // Skip consecutive duplicate messages (no allocation on the hot path)
    if (msgs.length > 0 && msgs[msgs.length - 1] === message) return;
    // Nanostore detects change by reference equality, so a new array is
    // required. At the cap, allocate exactly once at the final size (dropping
    // the oldest entry) rather than push-then-truncate.
    const next =
      msgs.length >= MAX_STATUS_MESSAGES
        ? [...msgs.slice(msgs.length - MAX_STATUS_MESSAGES + 1), message]
        : [...msgs, message];
    this.$statusMessages.set(next);
    this.emitChange();
  }

  setTasks(tasks: TaskItem[]): void {
    this.$tasks.set(tasks);
    this.emitChange();
  }

  updateTask(index: number, done: boolean): void {
    const tasks = this.$tasks.get();
    if (tasks[index]) {
      const updated = [...tasks];
      updated[index] = {
        ...updated[index],
        done,
        status: done ? TaskStatus.Completed : TaskStatus.Pending,
      };
      this.$tasks.set(updated);
      this.emitChange();
    }
  }

  setEventPlan(events: PlannedEvent[]): void {
    this.$eventPlan.set(events);
    this.emitChange();
  }

  get learnCardBlockIdx(): number {
    return this.$learnCardBlockIdx.get();
  }

  setLearnCardBlockIdx(idx: number): void {
    this.$learnCardBlockIdx.set(idx);
  }

  get learnCardComplete(): boolean {
    return this.$learnCardComplete.get();
  }

  setLearnCardComplete(): void {
    this.$learnCardComplete.set(true);
    this.emitChange();
  }

  syncTodos(
    todos: Array<{ content: string; status: string; activeForm?: string }>,
  ): void {
    const incoming = todos.map((t) => {
      const status = isTaskStatus(t.status) ? t.status : TaskStatus.Pending;
      return {
        label: t.content,
        activeForm: t.activeForm,
        status,
        done: status === TaskStatus.Completed,
      };
    });

    const incomingLabels = new Set(incoming.map((t) => t.label));

    const retained = this.$tasks
      .get()
      .filter((t) => t.done && !incomingLabels.has(t.label));

    this.$tasks.set([...retained, ...incoming]);
    this.emitChange();
    this._onTasksChanged?.();
  }

  /** Register a listener for task state changes (e.g. task stream push). */
  set onTasksChanged(fn: () => void) {
    this._onTasksChanged = fn;
  }

  // ── React integration ───────────────────────────────────────────

  subscribe(callback: () => void): () => void {
    return this.$version.listen(() => callback());
  }

  getSnapshot(): number {
    return this.$version.get();
  }
}
