/**
 * WizardStore — the TUI's store: the shared `SessionStore` plus the state only
 * the screens use. React components subscribe via useSyncExternalStore.
 *
 * The session and the run state live in `sessions`, the same kind of store
 * headless and embedders use, so `runProgram` writes them directly. This store
 * adds the TUI's own state (`TuiState`: the screens' answers and what an
 * overlay shows, read as `store.X`), display state (the token HUD, learn
 * cards), the router and the flow's gates, and re-resolves the screen and the
 * gates after every change to either.
 *
 * The active screen is derived from the session and the TUI state —
 * WizardRouter walks the flow and shows the first step whose `isComplete` is
 * still false. Define a step `gate` if its screen needs to await user
 * interactions; the TUI host calls `await store.getGate(stepId)` to pause
 * until it holds.
 */

import { atom } from 'nanostores';
import { logToFile } from '@utils/debug';
import { type AuthErrorDetail, type TokenUsageDelta } from '@agent/types';
import {
  initialTuiState,
  type TuiLaunchChoices,
  type TuiState,
  type TuiView,
} from '@tui/tui-state';
import {
  type OutroData,
  type PendingQuestion,
  type AskAnswers,
  type TaskNotice,
} from '@agent/types';
import { type DiscoveredFeature } from '@shared/discovered-feature';
import { McpOutcome, RunPhase } from '@shared/run-state';
import type { SettingsConflict } from '@shared/claude-settings';
import type { CloudRegion } from '@utils/types';
import { type WizardReadinessResult } from '@shared/health-checks/readiness';
import {
  WizardRouter,
  type ScreenName,
  ScreenId,
  Overlay,
  Program,
  type ProgramId,
} from './router.js';
import { analytics, sessionProperties } from '@utils/analytics';
import { buildSession, findProgramConfig, SessionStore } from '@programs';
import type { PlannedEvent, TaskItem, WizardSession } from '@programs/types';
import {
  addTokenUsage,
  EMPTY_TOKEN_USAGE,
  type TokenUsageSnapshot,
} from './token-usage.js';
import type { StoreInitContext } from './flow.js';
import { programFlowSteps } from './ai-opt-in-gate.js';
import { flowOwner } from './flow-owner.js';
import { IS_DEV } from '@shared/constants';

export { ScreenId, Overlay, Program };
export type { ScreenName, OutroData, TuiState, TuiView, ProgramId };

interface GateEntry {
  predicate: (view: TuiView) => boolean;
  promise: Promise<void>;
  resolve: () => void;
  resolved: boolean;
}

export class WizardStore implements TuiView {
  /** The shared session and run state; every session write goes through it. */
  readonly sessions: SessionStore;

  /** The TUI's own state: the screens' answers, overlay contents and launch choices. */
  private $tui = atom<TuiState>(initialTuiState());

  // ── Display-only atoms ────────────────────────────────────────────
  private $statusExpanded = atom(false);
  private $learnCardBlockIdx = atom(0);
  private $learnCardComplete = atom(false);
  private $version = atom(0);
  // Defaults on for local/dev/test runs (tsx, `pnpm try`, vitest) so
  // contributors see it without needing to know the shortcut; defaults off
  // for the published build, where it stays genuinely hidden. Still
  // Ctrl+T-toggleable either way.
  private $tokenHudVisible = atom(IS_DEV);
  /** The Visualizer tab's NOW PLAYING stage, and when it started. */
  private $currentStage = atom<{ stage: string; startedAt: number } | null>(
    null,
  );
  private $tokenUsage = atom<TokenUsageSnapshot>(EMPTY_TOKEN_USAGE);
  /** The code a screen asked to end the run with; the host applies it. */
  private $exitRequest = atom<number | null>(null);

  /** Last screen seen — used to detect screen transitions for analytics. */
  private _lastScreen: ScreenName | null = null;
  /** The ask and notice the overlays last showed, to open and close them as the session changes. */
  private _shownQuestion: PendingQuestion | null = null;
  private _shownNotice: TaskNotice | null = null;

  /** Hooks run when transitioning onto a screen. */
  private _enterScreenHooks = new Map<ScreenName, (() => void)[]>();

  /** Gate promises derived from program step definitions. */
  private _gates = new Map<string, GateEntry>();
  private _mcpOutcomeReported = false;

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

  constructor(
    program: ProgramId = Program.PostHogIntegration,
    sessions: SessionStore = new SessionStore(buildSession({})),
  ) {
    this.sessions = sessions;
    this.router = new WizardRouter(program);
    this._initFromProgram(program);
    this._shownQuestion = sessions.session.pendingQuestion;
    this._shownNotice = sessions.session.taskNotice;
    sessions.subscribe(() => this._onSessionChange());
  }

  /**
   * Scan program steps for gate predicates and create gate promises.
   *
   * Steps come from programFlowSteps (withAiOptInGate applied), so the injected ai-opt-in step's
   * gate registers here — the TUI host awaits it before any source leaves the
   * machine. Same wrapper screen-sequences.ts uses, so the gate and its screen
   * can't drift apart.
   */
  private _initFromProgram(program: ProgramId): void {
    const steps = programFlowSteps(program);
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

  /** Open or close the ask and notice overlays as the shared store's requests come and go. */
  private _onSessionChange(): void {
    const { pendingQuestion, taskNotice } = this.session;
    let closedOnly = false;
    if (pendingQuestion !== this._shownQuestion) {
      if (this._shownQuestion) this.router.popOverlay();
      if (pendingQuestion) this.router.pushOverlay(Overlay.WizardAsk);
      closedOnly = !pendingQuestion;
      this._shownQuestion = pendingQuestion;
    }
    if (taskNotice !== this._shownNotice) {
      if (this._shownNotice) this.router.popOverlay();
      if (taskNotice) this.router.pushOverlay(Overlay.TaskNotice);
      closedOnly = !taskNotice;
      this._shownNotice = taskNotice;
    }
    this.emitChange();
    if (closedOnly) this.router._setDirection('pop');
  }

  /**
   * Run the program steps' onInit callbacks. startTUI calls this once
   * the screens are actually rendering — constructing a store alone
   * (tests, playground) must not fire init work like the health-check
   * pre-flight, whose probes belong only to flows that show its screen.
   */
  runInitHooks(): void {
    const steps = flowOwner(this.router.activeProgram).flow;
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
   * Run the active program's `onReady` detection through the shared store, and
   * mark detection complete so `runProgram` doesn't repeat it. Call it after
   * the session is set, so it sees the real installDir.
   */
  async runReadyHooks(): Promise<void> {
    const config = findProgramConfig(this.router.activeProgram);
    await config?.onReady?.(this.sessions.readyContext());
    this.sessions.setDetectionComplete();
  }

  // ── Gate API ────────────────────────────────────────────────────

  /**
   * Get a gate promise by step ID — the primary blocking checkpoint API
   * for the TUI host. `await store.getGate('...')` parks the caller until the
   * corresponding program step's gate predicate flips to true (if the
   * predicate stays false, the caller stays parked indefinitely — the
   * TUI keeps rendering so the user can resolve whatever is blocking).
   *
   * If the program doesn't define a step with this ID, or the step
   * has no `gate` predicate, this returns an already-resolved promise
   * so the TUI host flows straight through. This lets programs opt in to
   * gates on a per-step basis without the TUI host needing to know which
   * gates exist in which flow.
   */
  getGate(stepId: string): Promise<void> {
    return this._gates.get(stepId)?.promise ?? Promise.resolve();
  }

  /**
   * Resolve once `predicate(store)` is true. Unlike a gate, this is created
   * at the await point and evaluated live against the store, so it
   * never latches on a startup value — the orchestrator uses it to wait for a
   * decision (a project picked, a handoff acknowledged) without the "true while
   * undecided" trap that latched gate predicates have.
   */
  waitUntil(predicate: (view: TuiView) => boolean): Promise<void> {
    if (predicate(this)) return Promise.resolve();
    return new Promise((resolve) => {
      const unsub = this.subscribe(() => {
        if (predicate(this)) {
          unsub();
          resolve();
        }
      });
    });
  }

  /**
   * Resolve once the flow has reached `stepId`: every step before it is
   * hidden or complete. Resolves whether `stepId` itself shows; a step the
   * active flow doesn't have shows.
   */
  reachStep(stepId: string): Promise<boolean> {
    const program = this.router.activeProgram;
    const steps = programFlowSteps(program);
    const index = steps.findIndex((step) => step.id === stepId);
    if (index === -1) return Promise.resolve(true);
    const before = steps.slice(0, index);
    const passed = (view: TuiView): boolean =>
      before.every((step) => {
        if (step.show && !step.show(view)) return true;
        const done = step.isComplete ?? step.gate;
        return !done || done(view);
      });
    const shows = steps[index].show;
    return this.waitUntil(passed).then(() => !shows || shows(this));
  }

  /**
   * Re-evaluate every gate predicate against the store and
   * resolve any whose predicate now returns true. Called after every
   * emitChange(), so gates unblock as soon as the session mutation
   * that satisfies them lands. Gates only resolve once — a predicate
   * that goes true → false → true will NOT re-block a caller that
   * already awaited through.
   */
  private _checkGates(): void {
    for (const [, gate] of this._gates) {
      if (!gate.resolved && gate.predicate(this)) {
        gate.resolved = true;
        gate.resolve();
      }
    }
  }

  // ── Reads ─────────────────────────────────────────────────────────

  get session(): WizardSession {
    return this.sessions.session;
  }

  /** Replace the session; the TUI state stays. */
  set session(value: WizardSession) {
    this.sessions.session = value;
  }

  get statusMessages(): string[] {
    return this.sessions.statusMessages;
  }

  get tasks(): TaskItem[] {
    return this.sessions.tasks;
  }

  get eventPlan(): PlannedEvent[] {
    return this.sessions.eventPlan;
  }

  get handoffText(): string | null {
    return this.sessions.handoffText;
  }

  // ── TUI state ─────────────────────────────────────────────────────

  get mcpFeatures(): TuiState['mcpFeatures'] {
    return this.$tui.get().mcpFeatures;
  }

  get programLabel(): TuiState['programLabel'] {
    return this.$tui.get().programLabel;
  }

  get setupConfirmed(): TuiState['setupConfirmed'] {
    return this.$tui.get().setupConfirmed;
  }

  get loginUrl(): TuiState['loginUrl'] {
    return this.$tui.get().loginUrl;
  }

  get authorizeUrl(): TuiState['authorizeUrl'] {
    return this.$tui.get().authorizeUrl;
  }

  get mcpComplete(): TuiState['mcpComplete'] {
    return this.$tui.get().mcpComplete;
  }

  get mcpOutcome(): TuiState['mcpOutcome'] {
    return this.$tui.get().mcpOutcome;
  }

  get mcpLoginCommands(): TuiState['mcpLoginCommands'] {
    return this.$tui.get().mcpLoginCommands;
  }

  get mcpInstalledClients(): TuiState['mcpInstalledClients'] {
    return this.$tui.get().mcpInstalledClients;
  }

  get mcpSuggestedPromptsDismissed(): TuiState['mcpSuggestedPromptsDismissed'] {
    return this.$tui.get().mcpSuggestedPromptsDismissed;
  }

  get slackStepDismissed(): TuiState['slackStepDismissed'] {
    return this.$tui.get().slackStepDismissed;
  }

  get slackConnected(): TuiState['slackConnected'] {
    return this.$tui.get().slackConnected;
  }

  get skillsComplete(): TuiState['skillsComplete'] {
    return this.$tui.get().skillsComplete;
  }

  get workflowsStepDone(): TuiState['workflowsStepDone'] {
    return this.$tui.get().workflowsStepDone;
  }

  get outroDismissed(): TuiState['outroDismissed'] {
    return this.$tui.get().outroDismissed;
  }

  get integrate(): TuiState['integrate'] {
    return this.$tui.get().integrate;
  }

  get completedRuns(): TuiState['completedRuns'] {
    return this.$tui.get().completedRuns;
  }

  get selfDrivingHandoffConfirmed(): TuiState['selfDrivingHandoffConfirmed'] {
    return this.$tui.get().selfDrivingHandoffConfirmed;
  }

  get githubConnected(): TuiState['githubConnected'] {
    return this.$tui.get().githubConnected;
  }

  get githubDeclined(): TuiState['githubDeclined'] {
    return this.$tui.get().githubDeclined;
  }

  get outageDismissed(): TuiState['outageDismissed'] {
    return this.$tui.get().outageDismissed;
  }

  get settingsOverrideKeys(): TuiState['settingsOverrideKeys'] {
    return this.$tui.get().settingsOverrideKeys;
  }

  get settingsConflicts(): TuiState['settingsConflicts'] {
    return this.$tui.get().settingsConflicts;
  }

  get authErrorDetail(): TuiState['authErrorDetail'] {
    return this.$tui.get().authErrorDetail;
  }

  get portConflictProcess(): TuiState['portConflictProcess'] {
    return this.$tui.get().portConflictProcess;
  }

  get spellbook(): TuiState['spellbook'] {
    return this.$tui.get().spellbook;
  }

  get mintHandoff(): TuiState['mintHandoff'] {
    return this.$tui.get().mintHandoff;
  }

  /** Write TUI state, then `sessionWrites`' session fields, with one notification either way. */
  private _write(patch: Partial<TuiState>, sessionWrites?: () => void): void {
    this.$tui.set({ ...this.$tui.get(), ...patch });
    const before = this.sessions.getVersion();
    if (sessionWrites) this.sessions.batch(sessionWrites);
    if (this.sessions.getVersion() === before) this.emitChange();
  }

  // ── Display state ───────────────────────────────────────────────

  get currentStage(): { stage: string; startedAt: number } | null {
    return this.$currentStage.get();
  }

  get tokenUsage(): TokenUsageSnapshot {
    return this.$tokenUsage.get();
  }

  /** No-op when the stage hasn't changed, so `startedAt` survives across
   *  re-renders and tab switches and measures real stage time. */
  setCurrentStage(stage: string): void {
    const cur = this.$currentStage.get();
    if (cur?.stage === stage) return;
    this.$currentStage.set({ stage, startedAt: Date.now() });
    this.emitChange();
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

  get exitRequest(): number | null {
    return this.$exitRequest.get();
  }

  /** A screen ends the run with `code`; the first request wins. */
  requestExit(code: number): void {
    if (this.$exitRequest.get() !== null) return;
    this.$exitRequest.set(code);
    this.emitChange();
  }

  // ── Writes ──────────────────────────────────────────────────────

  /** Start from the host's launch values: the session, and the TUI state from its defaults, `choices` and the program's label. */
  launch(
    session: WizardSession,
    choices: TuiLaunchChoices = {},
    programLabel: string | null = null,
  ): void {
    this.$tui.set(initialTuiState(choices, programLabel));
    this.sessions.session = session;
  }

  /** Sets setupConfirmed, and is the point consent becomes final. */
  completeSetup(): void {
    // Reports first: analytics merges tags into an event as it is sent, so
    // `setup confirmed` only carries the warehouse tags if they are already
    // set. On main they were, because reporting happened back in detect.
    this.sessions.markWarehouseSourcesReportedIfNeeded();
    analytics.wizardCapture('setup confirmed', sessionProperties(this.session));
    this._write({ setupConfirmed: true });
  }

  /**
   * Sharing is on: either the user turned it back on in the panel, or they
   * pressed Continue without ever touching it. Both are reversible until
   * completeSetup() resolves the intro gate and reports.
   */
  grantSharing(): void {
    this.sessions.grantSharing();
  }

  /**
   * Sharing is off. Suppresses reporting only — local detection still ran and
   * the results stay in the session, so the outro suggestion and the warehouse
   * task are unaffected; see `scanConsent` on `WizardSession`.
   *
   * Deliberately does not report. The panel's toggle can come back here, so
   * marking the run reported would strand a user who turns sharing off and
   * then on again. completeSetup() owns the single report.
   */
  declineSharing(): void {
    this.sessions.declineSharing();
  }

  setRunPhase(phase: RunPhase): void {
    this.sessions.setRunPhase(phase);
  }

  setCredentials(credentials: WizardSession['credentials']): void {
    this.sessions.setCredentials(credentials);
  }

  /** Post-refresh credential swap. No `auth complete`. */
  setAccessToken(credentials: WizardSession['credentials']): void {
    this.sessions.setAccessToken(credentials);
  }

  setRoleAtOrganization(role: string | null): void {
    this.sessions.setRoleAtOrganization(role);
  }

  setApiUser(user: WizardSession['apiUser']): void {
    this.sessions.setApiUser(user);
  }

  setFrameworkConfig(
    integration: WizardSession['integration'],
    config: WizardSession['frameworkConfig'],
  ): void {
    this.sessions.setFrameworkConfig(integration, config);
  }

  setDetectionComplete(): void {
    this.sessions.setDetectionComplete();
  }

  setDetectedFramework(label: string): void {
    this.sessions.setDetectedFramework(label);
  }

  setPosthogSdkDetected(detected: boolean): void {
    this.sessions.setPosthogSdkDetected(detected);
  }

  setSpellbook(spellbook: NonNullable<TuiState['spellbook']>): void {
    this._write({ spellbook });
  }

  setMintHandoff(action: NonNullable<TuiState['mintHandoff']>): void {
    // The parked agent may still hold a question or notice open.
    this._write({ mintHandoff: action }, () => {
      this.cancelPendingQuestion();
      if (this.session.taskNotice) this.resolveTaskNotice(false);
    });
  }

  setSkillId(skillId: string | null): void {
    this.sessions.setSkillId(skillId);
  }

  setUnsupportedVersion(info: {
    current: string;
    minimum: string;
    docsUrl: string;
  }): void {
    this.sessions.setUnsupportedVersion(info);
  }

  setLoginUrl(url: string | null): void {
    this._write({ loginUrl: url });
  }

  setAuthorizeUrl(url: string | null): void {
    this._write({ authorizeUrl: url });
  }

  setReadinessResult(result: WizardReadinessResult | null): void {
    this.sessions.setReadinessResult(result);
  }

  /** User dismissed the blocking outage screen. Gate resolves via _checkGates(). */
  dismissOutage(): void {
    logToFile('[health-checks] user dismissed outage screen, continuing');
    this._write({ outageDismissed: true });
  }

  /**
   * Push the settings-override overlay and return a promise that blocks
   * until the user dismisses it via backupAndFixSettingsOverride().
   */
  showSettingsOverride(
    conflicts: SettingsConflict[],
    backupAndFix: () => boolean,
  ): Promise<void> {
    this._backupAndFixSettings = backupAndFix;

    const hasReadOnly = conflicts.some((c) => !c.writable);
    if (hasReadOnly) {
      this.router.pushOverlay(Overlay.ManagedSettings);
    } else {
      this.router.pushOverlay(Overlay.SettingsOverride);
    }
    this._write({
      settingsOverrideKeys: conflicts.flatMap((c) => c.keys),
      settingsConflicts: conflicts,
    });

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
    this.router.pushOverlay(Overlay.PortConflict);
    this._write({ portConflictProcess: processInfo });
    return new Promise((resolve) => {
      this._resolvePortConflict = resolve;
    });
  }

  /** Dismiss the port-conflict overlay and retry the OAuth port loop. */
  resolvePortConflict(): void {
    this.router.popOverlay();
    this._write({ portConflictProcess: null });
    this.router._setDirection('pop');
    this._resolvePortConflict?.();
    this._resolvePortConflict = null;
  }

  /**
   * Show an optional step's notice and return whether to keep that step.
   * Asked before the step runs, so nobody is surprised by a prompt mid-run.
   */
  showTaskNotice(notice: TaskNotice): Promise<boolean> {
    return this.sessions.showTaskNotice(notice);
  }

  /** Dismiss the notice, keeping (`true`) or skipping (`false`) the step. */
  resolveTaskNotice(keep: boolean): void {
    this.sessions.resolveTaskNotice(keep);
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
  requestQuestion(
    question: PendingQuestion,
    onAnswer?: () => void,
  ): Promise<AskAnswers> {
    return this.sessions.requestQuestion(question, onAnswer);
  }

  /**
   * Report that the user answered one question of the in-flight request and
   * another is coming — the ask bridge's timeout heartbeat.
   */
  noteAskProgress(): void {
    this.sessions.noteAskProgress();
  }

  /**
   * Resolve the in-flight wizard_ask request with the user's answers and
   * dismiss the overlay. Answers flow back to the agent as the tool result.
   */
  resolvePendingQuestion(answers: AskAnswers): void {
    this.sessions.resolvePendingQuestion(answers);
  }

  /**
   * Cancel the in-flight wizard_ask request — the bridge sends a sentinel
   * answer ("__cancelled__") so the skill can decide how to handle it.
   */
  cancelPendingQuestion(): void {
    this.sessions.cancelPendingQuestion();
  }

  /**
   * Back up .claude/settings.json. Dismisses the overlay on success.
   */
  backupAndFixSettingsOverride(): boolean {
    const ok = this._backupAndFixSettings?.() ?? false;
    if (ok) {
      this.router.popOverlay();
      this._write({ settingsOverrideKeys: null, settingsConflicts: null });
      this.router._setDirection('pop');
      this._resolveSettingsOverride?.();
      this._resolveSettingsOverride = null;
      this._backupAndFixSettings = null;
    }
    return ok;
  }

  /** Push the auth-error overlay (no dismiss — user must exit). */
  showAuthError(detail?: AuthErrorDetail): void {
    this.router.pushOverlay(Overlay.AuthError);
    this._write({ authErrorDetail: detail ?? null });
  }

  /** Push the session-timeout overlay (no dismiss — user must exit). */
  showSessionTimeout(): void {
    this.pushOverlay(Overlay.SessionTimeout);
  }

  addDiscoveredFeature(feature: DiscoveredFeature): void {
    this.sessions.addDiscoveredFeature(feature);
  }

  /** Capture the MCP step's outcome once; the screen reports it as the results show, before Enter. */
  reportMcpOutcome(
    outcome: McpOutcome,
    installedClients: string[] = [],
    featuresSelected?: 'all' | string[],
  ): void {
    if (this._mcpOutcomeReported) return;
    this._mcpOutcomeReported = true;
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
  }

  /** Complete the MCP step; its `mcp complete` capture goes through `reportMcpOutcome`, so once per store. */
  setMcpComplete(
    outcome: McpOutcome = McpOutcome.Skipped,
    installedClients: string[] = [],
    featuresSelected?: 'all' | string[],
    loginCommands: string[] = [],
  ): void {
    this.reportMcpOutcome(outcome, installedClients, featuresSelected);
    this._write({
      mcpComplete: true,
      mcpOutcome: outcome,
      mcpLoginCommands: loginCommands,
      mcpInstalledClients: installedClients,
    });
  }

  setSkillsComplete(kept: boolean): void {
    analytics.wizardCapture('skills complete', {
      skills_kept: kept,
      ...sessionProperties(this.session),
    });
    this._write({ skillsComplete: true });
  }

  setMcpSuggestedPromptsDismissed(): void {
    this._write({ mcpSuggestedPromptsDismissed: true });
  }

  setSlackStepDismissed(): void {
    this._write({ slackStepDismissed: true });
  }

  setWorkflowsStepDone(): void {
    this._write({ workflowsStepDone: true });
  }

  setSlackConnected(connected: boolean): void {
    this._write({ slackConnected: connected });
  }

  setGithubConnected(connected: boolean): void {
    this._write({ githubConnected: connected });
  }

  /**
   * Self-driving GitHub gate declined. Carries the outro the user lands on,
   * since declining ends the flow before the agent runs and there is no abort
   * case to render one.
   */
  declineGithub(outroData: OutroData): void {
    this._write({ githubDeclined: true }, () =>
      this.sessions.update({ outroData }),
    );
  }

  /**
   * Self-driving integration-check answer. `true` → integrate the SDK as part
   * of this run; `false` → PostHog is already set up, go straight to
   * Self-driving. Resolves `store.integrate` from null.
   */
  setIntegrate(
    integrate: boolean,
    extra?: { via?: string; path?: string },
  ): void {
    analytics.wizardCapture('self-driving integration check', {
      self_driving_integrate: integrate,
      ...(extra?.via ? { self_driving_integrate_via: extra.via } : {}),
      ...(extra?.path ? { self_driving_integrate_path: extra.path } : {}),
      ...sessionProperties(this.session),
    });
    this._write({ integrate });
  }

  /**
   * Self-driving "no PostHog account" branch of the integration check. The
   * project has no SDK, so we always integrate (`integrate = true`); and since
   * the user has no account, we flip `signup` and record the `email` / `region`
   * collected on the screen so `authenticate` → `getOrAskForProjectData` takes
   * the provisioning path (create account + email a login link) instead of
   * OAuth. The "yes, I have an account" branch uses `setIntegrate(true)` and
   * leaves `signup` false so auth runs the normal OAuth login.
   */
  chooseProvisionAccount(email: string, region: CloudRegion): void {
    analytics.wizardCapture('self-driving integration check', {
      self_driving_integrate: true,
      self_driving_has_account: false,
      provision_region: region,
      ...sessionProperties(this.session),
    });
    this._write({ integrate: true }, () =>
      this.sessions.update({ signup: true, email, region }),
    );
  }

  /**
   * Self-driving handoff confirmed — the user acknowledged the post-integration
   * screen, so the Self-driving run can begin. Gate resolves via _checkGates().
   */
  confirmSelfDrivingHandoff(): void {
    this._write({ selfDrivingHandoffConfirmed: true });
  }

  /**
   * Mark a composed run step complete (e.g. self-driving's `integrate-run`).
   * Records the step id so its `isComplete` predicate holds, clears the task
   * list, and resets run phase to Idle so the next run step starts fresh.
   */
  completeRunStep(stepId: string): void {
    const done = this.completedRuns;
    this._write(
      { completedRuns: done.includes(stepId) ? done : [...done, stepId] },
      () => {
        this.sessions.setTasks([]);
        this.sessions.setRunPhase(RunPhase.Idle);
      },
    );
  }

  setOutroDismissed(dismissed = true): void {
    this._write({ outroDismissed: dismissed });
  }

  setOutroData(data: OutroData): void {
    this.sessions.setOutroData(data);
  }

  /** Show `data` on the outro screen: the error outro, with the run phase moved to Error. */
  showOutroError(data: OutroData): void {
    this.sessions.batch(() => {
      this.sessions.setOutroData(data);
      if (this.session.runPhase !== RunPhase.Error) {
        this.sessions.setRunPhase(RunPhase.Error);
      }
    });
  }

  setDashboardUrl(url: string): void {
    this.sessions.setDashboardUrl(url);
  }

  setNotebookUrl(url: string): void {
    this.sessions.setNotebookUrl(url);
  }

  setFrameworkContext(key: string, value: unknown): void {
    this.sessions.setFrameworkContext(key, value);
  }

  switchProgram(program: ProgramId): void {
    if (program === this.router.activeProgram) return;

    // Flush unresolved promises so the wizard can advance
    for (const gate of this._gates.values()) gate.resolve();
    this._gates.clear();

    this.router.setProgram(program);
    this._initFromProgram(program);
    // start-tui stamps this once at launch; without it here every event
    // after the switch still reports under the program the run started as.
    analytics.setTag('program_id', program);

    this._write({ setupConfirmed: false, programLabel: program }, () =>
      this.sessions.update({
        skillId: findProgramConfig(program)?.skillId ?? null,
      }),
    );
  }

  // ── Derived state ───────────────────────────────────────────────

  /**
   * The screen that should be rendered right now.
   * Derived from session and TUI state via the router.
   */
  get currentScreen(): ScreenName {
    return this.router.resolve(this);
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

  /** The program the visible screen reports under; screens stamp this on their
   *  own events rather than relying on the run-level `program_id` tag. */
  get analyticsProgramId(): ProgramId {
    return this.router.activeProgram;
  }

  /**
   * Detect screen transitions, run enter-screen hooks, and fire analytics.
   * Called at the end of emitChange/pushOverlay/popOverlay.
   */
  private _detectTransition(): void {
    const next = this.router.resolve(this);
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
    this.sessions.pushStatus(message);
  }

  get tokenHudVisible(): boolean {
    return this.$tokenHudVisible.get();
  }

  /** Hidden Ctrl+T shortcut — see ScreenContainer. Not registered as a
   *  keyboard hint, so it never shows in the hints bar. */
  toggleTokenHud(): void {
    this.$tokenHudVisible.set(!this.$tokenHudVisible.get());
    this.emitChange();
  }

  /**
   * Accumulate one assistant turn's token usage into the running estimate.
   * Approximate by design (no dedup for SDK-retried/replayed turns, unlike
   * the benchmark middleware's TurnCounterPlugin) — it's a live indicator
   * for a hidden debug HUD, not a billing record, and `setFinalTokenCostUsd`
   * corrects the total once the run's authoritative cost is known.
   */
  addTokenUsage(delta: TokenUsageDelta): void {
    const next = addTokenUsage(this.$tokenUsage.get(), delta);
    if (next === this.$tokenUsage.get()) return;
    this.$tokenUsage.set(next);
    this.emitChange();
  }

  /** Reconcile the running cost estimate to the SDK's authoritative total
   *  once the agent run completes — same trick the benchmark's
   *  CostTrackerPlugin.onFinalize uses to correct any per-turn drift. */
  setFinalTokenCostUsd(costUsd: number): void {
    const cur = this.$tokenUsage.get();
    this.$tokenUsage.set({ ...cur, costUsd, costIsFinal: true });
    this.emitChange();
  }

  setTasks(tasks: TaskItem[]): void {
    this.sessions.setTasks(tasks);
  }

  updateTask(index: number, done: boolean): void {
    this.sessions.updateTask(index, done);
  }

  setEventPlan(events: PlannedEvent[]): void {
    this.sessions.setEventPlan(events);
  }

  setHandoffText(text: string): void {
    this.sessions.setHandoffText(text);
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
    todos: Array<{
      id?: string;
      source?: string;
      content: string;
      status: string;
      activeForm?: string;
    }>,
  ): void {
    this.sessions.syncTodos(todos);
  }

  // ── React integration ───────────────────────────────────────────

  subscribe(callback: () => void): () => void {
    return this.$version.listen(() => callback());
  }

  getSnapshot(): number {
    return this.$version.get();
  }
}
