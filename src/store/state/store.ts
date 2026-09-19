/**
 * FlowStore — the state a program flow spans across agent runs: the flow and
 * its gates, the interrupts, the session every run inherits, and the active
 * RunStore. Screens read it; agents write to the run through WizardUI. The
 * active screen is derived from state; setters always emitChange().
 */

import { atom, map } from 'nanostores';
import { logToFile } from '../shared/debug.js';
import {
  TaskStatus,
  type AuthErrorDetail,
  type TokenUsageDelta,
} from '../ui/wizard-ui.js';
import {
  type WizardSession,
  type OutroData,
  type DiscoveredFeature,
  type PendingQuestion,
  type AskAnswers,
  type CloudRegion,
  AdditionalFeature,
  McpOutcome,
  RunPhase,
  ScanConsent,
  buildSession,
  type TaskNotice,
} from '../session/wizard-session.js';
import type { SettingsConflict } from '../services/claude-settings.js';
import {
  WizardReadiness,
  getBlockingServiceKeys,
  type WizardReadinessResult,
} from '../health-checks/readiness.js';
import { Interrupt } from './interrupts.js';
import { resolveActiveScreen } from './flow-resolution.js';
import type { Flow } from './flow.js';
import { Program, type ProgramId } from '../programs/program-registry.js';
import { analytics, sessionProperties } from '../shared/analytics.js';
import type { StoreInitContext, ProgramReadyContext } from './flow.js';
import { reportWarehouseSourcesDetected } from '../programs/posthog-integration/detect.js';
import {
  RUN_SESSION_DEFAULTS,
  RunStore,
  pickRunSession,
  type PlannedEvent,
  type TaskItem,
  type TokenUsageSnapshot,
} from './run-store.js';

export { TaskStatus, Program, RunPhase, McpOutcome };
export type { OutroData, WizardSession, ProgramId };
export {
  EMPTY_TOKEN_USAGE,
  MAX_STATUS_MESSAGES,
  RUN_SESSION_KEYS,
  RunStore,
  totalTokenCount,
} from './run-store.js';
export type {
  PlannedEvent,
  TaskItem,
  TokenUsageSnapshot,
} from './run-store.js';

interface GateEntry {
  predicate: (session: WizardSession) => boolean;
  promise: Promise<void>;
  resolve: () => void;
  resolved: boolean;
}

// Capture blocked skill downloads once per readiness result.
function captureHealthCheckBlocked(result: WizardReadinessResult): void {
  try {
    const health = result.health;
    const blockingKeys = getBlockingServiceKeys(health);
    const attempts = health.skillsOrigin.rawIndicator?.match(/attempts=(\d+)/);
    const retriesUsed = Math.max(0, attempts ? Number(attempts[1]) - 1 : 0);

    analytics.wizardCapture('health check blocked', {
      decision: 'skills-origin-down',
      blocking_keys: blockingKeys,
      retries_used: retriesUsed,
    });
  } catch (err) {
    logToFile(
      `[health-checks] failed to capture analytics: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

export class FlowStore {
  /** The session every run inherits; run-scoped keys are read from the active run instead. */
  private $session = map<WizardSession>(buildSession({}));
  private $version = atom(0);

  private _run: RunStore;
  private _unsubscribeRun: () => void;

  /** Last screen seen — used to detect screen transitions for analytics. */
  private _lastScreen: string | null = null;

  /** Hooks run when transitioning onto a screen. */
  private _enterScreenHooks = new Map<string, (() => void)[]>();

  /** Gate promises derived from program step definitions. */
  private _gates = new Map<string, GateEntry>();

  version = '';

  /** The flow this store walks. Set by whoever composes the run. */
  private _flow: Flow;
  /** Interrupts take over the active screen until dismissed, last on top. */
  private _interrupts: Interrupt[] = [];

  /** Blocks OAuth flow until the port-conflict overlay is dismissed. */
  private _resolvePortConflict: (() => void) | null = null;

  /** Resolves the OAuth flow with a manually-entered authorization code. */
  private _resolveManualAuthCode: ((code: string) => void) | null = null;

  constructor(flow: Flow) {
    this._flow = flow;
    this._initGates(flow);
    this._run = new RunStore(this.$session.get());
    this._unsubscribeRun = this._run.subscribe(() => this.emitChange());
  }

  /** Create one gate promise per step that declares a `gate` predicate. */
  private _initGates(flow: Flow): void {
    for (const step of flow.steps) {
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

  // ── Runs ────────────────────────────────────────────────────────

  /** The store of the active (or last) agent run. */
  get run(): RunStore {
    return this._run;
  }

  /**
   * Begin one independent agent run: a fresh RunStore seeded from `session`
   * with a clean run state. The previous run's open question or notice is
   * cancelled; credentials, detection, and setup live here and carry over.
   */
  startRun(session: WizardSession): RunStore {
    this.cancelPendingQuestion();
    if (this._run.session.taskNotice) this.resolveTaskNotice(false);
    this._unsubscribeRun();
    this._run = new RunStore({ ...session, ...RUN_SESSION_DEFAULTS });
    this._unsubscribeRun = this._run.subscribe(() => this.emitChange());
    this.emitChange();
    return this._run;
  }

  /**
   * Mark a composed run step complete (e.g. self-driving's `integrate-run`).
   * Records the step id so its `isComplete` predicate holds, clears the task
   * list, and resets run phase to Idle so the next run step starts fresh.
   */
  completeRunStep(stepId: string): void {
    const done = this.$session.get().completedRuns;
    if (!done.includes(stepId)) {
      this.$session.setKey('completedRuns', [...done, stepId]);
    }
    this._run.setTasks([], false);
    this._run.setRunPhase(RunPhase.Idle);
  }

  /** A controlled run's parent released the agent; the runner waits on this. */
  requestRun(): void {
    this.$session.setKey('runRequested', true);
    this.emitChange();
  }

  /**
   * Run the program steps' onInit callbacks. startTUI calls this once the
   * screens are actually rendering — constructing a store alone (tests,
   * playground) must not fire init work like the health-check pre-flight.
   */
  runInitHooks(): void {
    const steps = this._flow.steps;
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
   * Run all `onReady` hooks declared by the current flow's steps, in order.
   * Must be called after `store.session = session` so hooks see the real
   * installDir.
   */
  async runReadyHooks(): Promise<void> {
    const steps = this._flow.steps;
    const ctx: ProgramReadyContext = {
      session: this.session,
      setFrameworkContext: (k, v) => this.setFrameworkContext(k, v),
      setFrameworkConfig: (i, c) => this.setFrameworkConfig(i, c),
      setDetectedFramework: (l) => this.setDetectedFramework(l),
      setPosthogSdkDetected: (d) => this.setPosthogSdkDetected(d),
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
   * The blocking checkpoint for a runner: parks until the step's gate
   * predicate flips to true. A step without a gate resolves at once.
   */
  getGate(stepId: string): Promise<void> {
    return this._gates.get(stepId)?.promise ?? Promise.resolve();
  }

  /** Resolve once `predicate(session)` is true, evaluated live; never latches on a startup value. */
  waitUntil(predicate: (session: WizardSession) => boolean): Promise<void> {
    if (predicate(this.session)) return Promise.resolve();
    return new Promise((resolve) => {
      const unsub = this.subscribe(() => {
        if (predicate(this.session)) {
          unsub();
          resolve();
        }
      });
    });
  }

  /** Gates resolve once; a predicate that goes true, false, true does not re-block. */
  private _checkGates(): void {
    for (const [, gate] of this._gates) {
      if (!gate.resolved && gate.predicate(this.session)) {
        gate.resolved = true;
        gate.resolve();
      }
    }
  }

  // ── State accessors ─────────────────────────────────────────────

  /** The session as screens read it: the flow's, with the active run's own keys on top. */
  get session(): WizardSession {
    return { ...this.$session.get(), ...pickRunSession(this._run.session) };
  }

  set session(value: WizardSession) {
    this.$session.set(value);
    this._run.patchSession(pickRunSession(value), false);
    this.emitChange();
  }

  get statusMessages(): string[] {
    return this._run.statusMessages;
  }

  get tasks(): TaskItem[] {
    return this._run.tasks;
  }

  get eventPlan(): PlannedEvent[] {
    return this._run.eventPlan;
  }

  get handoffText(): string | null {
    return this._run.handoffText;
  }

  get currentStage(): { stage: string; startedAt: number } | null {
    return this._run.currentStage;
  }

  get tokenUsage(): TokenUsageSnapshot {
    return this._run.tokenUsage;
  }

  setCurrentStage(stage: string): void {
    this._run.setCurrentStage(stage);
  }

  // ── Session setters ─────────────────────────────────────────────
  // Every setter that affects screen resolution calls emitChange().
  // Business logic calls these instead of mutating session directly.

  /** Sets setupConfirmed, and is the point consent becomes final. */
  completeSetup(): void {
    this.$session.setKey('setupConfirmed', true);
    // Reports first: analytics merges tags into an event as it is sent, so
    // `setup confirmed` only carries the warehouse tags if they are already set.
    this._markWarehouseSourcesReportedIfNeeded();
    analytics.wizardCapture('setup confirmed', sessionProperties(this.session));
    this.emitChange();
  }

  /** Sharing is on; reversible until completeSetup() reports. */
  grantSharing(): void {
    this.$session.setKey('scanConsent', ScanConsent.Granted);
    this.emitChange();
  }

  /** Sharing is off: suppresses reporting only; detection results stay. */
  declineSharing(): void {
    this.$session.setKey('scanConsent', ScanConsent.Declined);
    this.emitChange();
  }

  /** completeSetup() owns the single warehouse-sources report; this supplies its idempotency flag. */
  private _markWarehouseSourcesReportedIfNeeded(): void {
    if (reportWarehouseSourcesDetected(this.session)) {
      this.$session.setKey('warehouseSourcesReported', true);
    }
  }

  setRunPhase(phase: RunPhase): void {
    this._run.setRunPhase(phase);
  }

  setCredentials(credentials: WizardSession['credentials']): void {
    this.$session.setKey('credentials', credentials);
    if (credentials?.projectId) {
      analytics.setTag('project_id', credentials.projectId);
    }
    analytics.wizardCapture('auth complete', {
      project_id: credentials?.projectId,
    });
    this.emitChange();
  }

  /** Post-refresh credential swap. No `auth complete` — see WizardUI. */
  setAccessToken(credentials: WizardSession['credentials']): void {
    this.$session.setKey('credentials', credentials);
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
    if (integration) analytics.setTag('integration', integration);
    this.emitChange();
  }

  setDetectionComplete(): void {
    this.$session.setKey('detectionComplete', true);
    this.emitChange();
  }

  setDetectedFramework(label: string): void {
    this.$session.setKey('detectedFrameworkLabel', label);
    analytics.setTag('detected_framework', label);
    this.emitChange();
  }

  setPosthogSdkDetected(detected: boolean): void {
    this.$session.setKey('posthogSdkDetected', detected);
    this.emitChange();
  }

  setSpellbook(spellbook: NonNullable<WizardSession['spellbook']>): void {
    this.$session.setKey('spellbook', spellbook);
    this.emitChange();
  }

  setMintHandoff(action: NonNullable<WizardSession['mintHandoff']>): void {
    // The parked agent may still hold a question or notice open.
    this.cancelPendingQuestion();
    if (this._run.session.taskNotice) this.resolveTaskNotice(false);
    this._run.setMintHandoff(action);
  }

  /** The skill lives with the flow and with the run the agent is in. */
  setSkillId(skillId: string | null): void {
    this.$session.setKey('skillId', skillId);
    this._run.setSkillId(skillId, false);
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
    if (result && result.decision === WizardReadiness.No) {
      captureHealthCheckBlocked(result);
    }
    this.emitChange();
  }

  /** User dismissed the blocking outage screen. Gate resolves via _checkGates(). */
  dismissOutage(): void {
    logToFile('[health-checks] user dismissed outage screen, continuing');
    this.$session.setKey('outageDismissed', true);
    this.emitChange();
  }

  /** Push the settings-override overlay; resolves when backupAndFixSettingsOverride() succeeds. */
  showSettingsOverride(
    conflicts: SettingsConflict[],
    backupAndFix: () => boolean,
  ): Promise<void> {
    const pending = this._run.showSettingsOverride(conflicts, backupAndFix);
    const hasReadOnly = conflicts.some((c) => !c.writable);
    this.pushInterrupt(
      hasReadOnly ? Interrupt.ManagedSettings : Interrupt.SettingsOverride,
    );
    return pending;
  }

  /** Push the port-conflict overlay; resolves when the user frees the ports and retries. */
  showPortConflict(processInfo: {
    command: string;
    pid: string;
    port: number;
    user: string;
  }): Promise<void> {
    this.$session.setKey('portConflictProcess', processInfo);
    this.pushInterrupt(Interrupt.PortConflict);
    return new Promise((resolve) => {
      this._resolvePortConflict = resolve;
    });
  }

  /** Dismiss the port-conflict overlay and retry the OAuth port loop. */
  resolvePortConflict(): void {
    this.$session.setKey('portConflictProcess', null);
    this.popInterrupt();
    this._resolvePortConflict?.();
    this._resolvePortConflict = null;
  }

  /** Show an optional step's notice before it runs; resolves with whether to keep the step. */
  showTaskNotice(notice: TaskNotice): Promise<boolean> {
    const pending = this._run.showTaskNotice(notice);
    this.pushInterrupt(Interrupt.TaskNotice);
    return pending;
  }

  /** Dismiss the notice, keeping (`true`) or skipping (`false`) the step. */
  resolveTaskNotice(keep: boolean): void {
    this._run.resolveTaskNotice(keep);
    this.popInterrupt();
  }

  /** Resolves when the user submits a manually-entered OAuth code; raced against the callback server. */
  waitForManualAuthCode(): Promise<string> {
    return new Promise<string>((resolve) => {
      this._resolveManualAuthCode = resolve;
    });
  }

  /** Open the manual OAuth code-entry overlay over the auth screen. */
  showManualAuthCode(): void {
    this.pushInterrupt(Interrupt.ManualAuthCode);
  }

  /** Dismiss the manual OAuth code overlay without submitting. */
  dismissManualAuthCode(): void {
    this.popInterrupt();
  }

  /** Submit a manually-entered authorization code: dismiss the overlay and resolve the OAuth flow. */
  submitManualAuthCode(code: string): void {
    this.popInterrupt();
    this._resolveManualAuthCode?.(code);
    this._resolveManualAuthCode = null;
  }

  /** Open the WizardAsk overlay; resolves with the answers, or the cancel sentinels. One request at a time. */
  requestQuestion(question: PendingQuestion): Promise<AskAnswers> {
    const pending = this._run.requestQuestion(question);
    this.pushInterrupt(Interrupt.WizardAsk);
    analytics.wizardCapture('wizard_ask shown', {
      source: question.source,
      question_count: question.questions.length,
      kinds: question.questions.map((q) => q.kind),
    });
    return pending;
  }

  /** Resolve the in-flight wizard_ask request and dismiss the overlay. */
  resolvePendingQuestion(answers: AskAnswers): void {
    this._run.resolvePendingQuestion(answers);
    this.popInterrupt();
  }

  /** Cancel the in-flight wizard_ask request with the `__cancelled__` sentinel per question. */
  cancelPendingQuestion(): void {
    const pending = this._run.session.pendingQuestion;
    if (!pending) return;
    const cancelled: AskAnswers = {};
    for (const q of pending.questions) {
      cancelled[q.id] = '__cancelled__';
    }
    this.resolvePendingQuestion(cancelled);
  }

  /** Back up .claude/settings.json. Dismisses the overlay on success. */
  backupAndFixSettingsOverride(): boolean {
    const ok = this._run.backupAndFixSettingsOverride();
    if (ok) this.popInterrupt();
    return ok;
  }

  /** Push the auth-error overlay (no dismiss — user must exit). */
  showAuthError(detail?: AuthErrorDetail): void {
    this.$session.setKey('authErrorDetail', detail ?? null);
    this.pushInterrupt(Interrupt.AuthError);
  }

  /** Push the session-timeout overlay (no dismiss — user must exit). */
  showSessionTimeout(): void {
    this.pushInterrupt(Interrupt.SessionTimeout);
  }

  addDiscoveredFeature(feature: DiscoveredFeature): void {
    const features = this.$session.get().discoveredFeatures;
    if (!features.includes(feature)) {
      this.$session.setKey('discoveredFeatures', [...features, feature]);
      this.emitChange();
    }
  }

  /** Enable an additional feature: enqueue it for the stop hook and set its session flags. */
  enableFeature(feature: AdditionalFeature): void {
    const queue = this.$session.get().additionalFeatureQueue;
    if (!queue.includes(feature)) {
      const next = [...queue, feature];
      this.$session.setKey('additionalFeatureQueue', next);
      // Distinct key from `sessionProperties()`'s array-valued `additional_features`.
      analytics.setTag('additional_feature_kinds', next.join(','));
    }
    if (feature === AdditionalFeature.LLM) {
      this.$session.setKey('llmOptIn', true);
    }
    analytics.wizardCapture('feature enabled', { feature });
    this.emitChange();
  }

  setMcpComplete(
    outcome: McpOutcome = McpOutcome.Skipped,
    installedClients: string[] = [],
    featuresSelected?: 'all' | string[],
    loginCommands: string[] = [],
  ): void {
    this.$session.setKey('mcpComplete', true);
    this.$session.setKey('mcpOutcome', outcome);
    this.$session.setKey('mcpInstalledClients', installedClients);
    this.$session.setKey('mcpLoginCommands', loginCommands);
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

  setGithubConnected(connected: boolean): void {
    this.$session.setKey('githubConnected', connected);
    this.emitChange();
  }

  /** Self-driving GitHub gate declined: carries the outro the user lands on, since no run renders one. */
  declineGithub(outroData: OutroData): void {
    this.$session.setKey('githubDeclined', true);
    this._run.setOutroData(outroData, false);
    this.emitChange();
  }

  /** Self-driving integration-check answer; resolves `session.integrate` from null. */
  setIntegrate(
    integrate: boolean,
    extra?: { via?: string; path?: string },
  ): void {
    this.$session.setKey('integrate', integrate);
    analytics.wizardCapture('self-driving integration check', {
      self_driving_integrate: integrate,
      ...(extra?.via ? { self_driving_integrate_via: extra.via } : {}),
      ...(extra?.path ? { self_driving_integrate_path: extra.path } : {}),
      ...sessionProperties(this.session),
    });
    this.emitChange();
  }

  /** Self-driving "no PostHog account" branch: integrate, and provision an account at auth. */
  chooseProvisionAccount(email: string, region: CloudRegion): void {
    this.$session.setKey('signup', true);
    this.$session.setKey('email', email);
    this.$session.setKey('region', region);
    this.$session.setKey('integrate', true);
    analytics.wizardCapture('self-driving integration check', {
      self_driving_integrate: true,
      self_driving_has_account: false,
      provision_region: region,
      ...sessionProperties(this.session),
    });
    this.emitChange();
  }

  /** Self-driving handoff confirmed; the Self-driving run can begin. */
  confirmSelfDrivingHandoff(): void {
    this.$session.setKey('selfDrivingHandoffConfirmed', true);
    this.emitChange();
  }

  setOutroDismissed(dismissed = true): void {
    this._run.setOutroDismissed(dismissed);
  }

  setOutroData(data: OutroData): void {
    this._run.setOutroData(data);
  }

  /** Artefacts a run created for the project outlive it: later runs and the outro link them. */
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

  /** Context lives with the flow and with the run the agent is in. */
  setFrameworkContext(key: string, value: unknown): void {
    const ctx = { ...this.$session.get().frameworkContext, [key]: value };
    this.$session.setKey('frameworkContext', ctx);
    this._run.setFrameworkContext(key, value, false);
    this.emitChange();
  }

  switchProgram(flow: Flow): void {
    if (flow.programId === this._flow.programId) return;

    // Flush unresolved promises so the wizard can advance
    for (const gate of this._gates.values()) gate.resolve();
    this._gates.clear();

    this._interrupts = [];
    this._flow = flow;
    this._initGates(flow);
    // start-tui stamps this once at launch; without it here every event
    // after the switch still reports under the program the run started as.
    analytics.setTag('program_id', flow.programId);

    this.$session.setKey('setupConfirmed', false);
    this.$session.setKey('programLabel', flow.programId);
    this.$session.setKey('skillId', flow.skillId);
    this._run.setSkillId(flow.skillId, false);
    this.emitChange();
  }

  // ── Derived state ───────────────────────────────────────────────

  get flow(): Flow {
    return this._flow;
  }

  /** The id of the active program. */
  get activeProgram(): ProgramId {
    return this._flow.programId;
  }

  /** The screen key that should be rendered right now, derived from state. */
  get currentScreen(): string {
    return resolveActiveScreen(this._flow, this.session, this._interrupts);
  }

  get hasInterrupt(): boolean {
    return this._interrupts.length > 0;
  }

  get interruptDepth(): number {
    return this._interrupts.length;
  }

  // ── Change notification ─────────────────────────────────────────

  getVersion(): number {
    return this.$version.get();
  }

  /** Bump the version, resolve gates that came true, and record a screen transition. */
  emitChange(): void {
    this.$version.set(this.$version.get() + 1);
    this._checkGates();
    this._detectTransition();
  }

  // ── Interrupts ──────────────────────────────────────────────────

  pushInterrupt(interrupt: Interrupt): void {
    this._interrupts.push(interrupt);
    this.$version.set(this.$version.get() + 1);
    this._detectTransition();
  }

  popInterrupt(): void {
    this._interrupts.pop();
    this.$version.set(this.$version.get() + 1);
    this._detectTransition();
  }

  // ── Screen transition analytics ───────────────────────────────────

  /** Register a callback to run after every transition that lands on `screen`. */
  onEnterScreen(screen: string, fn: () => void): void {
    const list = this._enterScreenHooks.get(screen) ?? [];
    list.push(fn);
    this._enterScreenHooks.set(screen, list);
  }

  /** The program `screen` reports under: its step's `reportsAsProgramId`, else the running program. */
  private _programIdForScreen(screen: string): ProgramId {
    const program = this._flow.programId;
    const step = this._flow.steps.find((s) => s.screenId === screen);
    return step?.reportsAsProgramId ?? program;
  }

  /** The program the visible screen reports under. */
  get analyticsProgramId(): ProgramId {
    return this._programIdForScreen(this.currentScreen);
  }

  private _detectTransition(): void {
    const next = this.currentScreen;
    const prev = this._lastScreen;
    if (next !== prev) {
      // Every event carries the active TUI screen, filling the "URL / Screen" column.
      analytics.setTag('$screen_name', next);
    }
    if (prev !== null && next !== prev) {
      const hooks = this._enterScreenHooks.get(next);
      if (hooks) {
        for (const fn of hooks) fn();
      }
      analytics.wizardCapture(`screen ${next}`, {
        from_screen: prev,
        program_id: this._programIdForScreen(next),
        ...sessionProperties(this.session),
      });
    }
    this._lastScreen = next;
  }

  // ── Agent observation state, delegated to the active run ────────

  pushStatus(message: string): void {
    this._run.pushStatus(message);
  }

  addTokenUsage(delta: TokenUsageDelta): void {
    this._run.addTokenUsage(delta);
  }

  setFinalTokenCostUsd(costUsd: number): void {
    this._run.setFinalTokenCostUsd(costUsd);
  }

  setTasks(tasks: TaskItem[]): void {
    this._run.setTasks(tasks);
  }

  updateTask(index: number, done: boolean): void {
    this._run.updateTask(index, done);
  }

  setEventPlan(events: PlannedEvent[]): void {
    this._run.setEventPlan(events);
  }

  setHandoffText(text: string): void {
    this._run.setHandoffText(text);
  }

  syncTodos(
    todos: Array<{ content: string; status: string; activeForm?: string }>,
  ): void {
    this._run.syncTodos(todos);
  }

  /** Register a listener for task state changes on the active run. */
  set onTasksChanged(fn: () => void) {
    this._run.onTasksChanged = fn;
  }

  // ── React integration ───────────────────────────────────────────

  subscribe(callback: () => void): () => void {
    return this.$version.listen(() => callback());
  }

  getSnapshot(): number {
    return this.$version.get();
  }
}
