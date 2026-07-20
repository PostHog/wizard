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
import {
  TaskStatus,
  isTaskStatus,
  type AuthErrorDetail,
  type TokenUsageDelta,
} from '@ui/wizard-ui';
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
  buildSession,
} from '@lib/wizard-session';
import type { SettingsConflict } from '@lib/agent/claude-settings';
import {
  WizardReadiness,
  getBlockingServiceKeys,
  type WizardReadinessResult,
} from '@lib/health-checks/readiness';
import { ServiceHealthStatus } from '@lib/health-checks/types';
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
import { getDetectedWarehouseSources } from '@lib/programs/warehouse-source/detect';
import { EXPANDED_COUNT } from '@ui/tui/constants';
import { IS_DEV } from '@lib/constants';
import { computeTokenCostUsd } from '@lib/agent/token-pricing';

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

/**
 * Running token/cost estimate for the hidden Ctrl+T HUD. Accumulated live
 * from each assistant turn's usage (see `agent-interface.ts`), then
 * reconciled to the SDK's authoritative `total_cost_usd` once the run
 * completes — `costIsFinal` flips so the HUD can show the number as exact
 * rather than a running estimate.
 */
export interface TokenUsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  costIsFinal: boolean;
}

const EMPTY_TOKEN_USAGE: TokenUsageSnapshot = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  costUsd: 0,
  costIsFinal: false,
};

/** Total tokens across all counters in a `TokenUsageSnapshot` — used by
 *  both `TokenCostHud` and `exit-line.ts` to detect "no agent turns yet". */
export function totalTokenCount(usage: TokenUsageSnapshot): number {
  return (
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheReadTokens +
    usage.cacheCreationTokens
  );
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

/**
 * Fired once per blocked readiness result, so we can quantify how often
 * the wizard refuses to start and — crucially — split that between
 * confirmed PostHog outages and probe-level reachability failures that
 * are most likely the user's network. Helps us decide whether the
 * health-check UX is over-firing.
 */
function captureHealthCheckBlocked(result: WizardReadinessResult): void {
  try {
    const health = result.health;
    const blockingKeys = getBlockingServiceKeys(health);
    const blockingStatuses = blockingKeys.map((k) => health[k]?.status);

    const allNoConnection =
      blockingStatuses.length > 0 &&
      blockingStatuses.every((s) => s === ServiceHealthStatus.NoConnection);
    const onlyGithubReleases =
      blockingKeys.length === 1 && blockingKeys[0] === 'githubReleases';

    const decision = onlyGithubReleases
      ? 'github-releases-down'
      : allNoConnection
      ? 'no-connection'
      : 'confirmed-outage';

    const posthogStatus = health.posthogOverall?.status;
    const retriesUsed = Math.max(
      0,
      ...(['llmGateway', 'mcp', 'githubReleases'] as const).map((k) => {
        const ind = health[k]?.rawIndicator ?? '';
        const m = ind.match(/attempts=(\d+)/);
        return m ? Number(m[1]) - 1 : 0;
      }),
    );

    analytics.wizardCapture('health check blocked', {
      decision,
      blocking_keys: blockingKeys,
      posthog_status_reachable:
        posthogStatus !== ServiceHealthStatus.NoConnection,
      posthog_status_reports_incident:
        posthogStatus === ServiceHealthStatus.Down ||
        posthogStatus === ServiceHealthStatus.Degraded,
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
  private $currentStage = atom<{ stage: string; startedAt: number } | null>(
    null,
  );
  private $tokenUsage = atom<TokenUsageSnapshot>(EMPTY_TOKEN_USAGE);
  // Defaults on for local/dev/test runs (tsx, `pnpm try`, vitest) so
  // contributors see it without needing to know the shortcut; defaults off
  // for the published build, where it stays genuinely hidden. Still
  // Ctrl+T-toggleable either way.
  private $tokenHudVisible = atom(IS_DEV);

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
   * Resolve once `predicate(session)` is true. Unlike a gate, this is created
   * at the await point and evaluated live against the current session, so it
   * never latches on a startup value — the orchestrator uses it to wait for a
   * decision (a project picked, a handoff acknowledged) without the "true while
   * undecided" trap that latched gate predicates have.
   */
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

  get currentStage(): { stage: string; startedAt: number } | null {
    return this.$currentStage.get();
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
    if (credentials?.projectId) {
      analytics.setTag('project_id', credentials.projectId);
    }
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

  /**
   * Self-driving integration-check answer. `true` → integrate the SDK as part
   * of this run; `false` → PostHog is already set up, go straight to
   * Self-driving. Resolves `session.integrate` from null.
   */
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

  /**
   * Warehouse-offer answer in the default integration flow. `true` → connect
   * the detected data warehouse sources after the SDK integration; `false` →
   * skip. Resolves `session.warehouseOptIn` from null.
   *
   * Answered before auth, because the answer decides which agent run is
   * `composed` (the last run owns the outro) — see POSTHOG_INTEGRATION_PROGRAM.
   */
  setWarehouseOptIn(optIn: boolean): void {
    this.$session.setKey('warehouseOptIn', optIn);
    analytics.wizardCapture('warehouse offer answered', {
      warehouse_opt_in: optIn,
      warehouse_source_count: getDetectedWarehouseSources(this.session).length,
      ...sessionProperties(this.session),
    });
    this.emitChange();
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

  /**
   * Self-driving handoff confirmed — the user acknowledged the post-integration
   * screen, so the Self-driving run can begin. Gate resolves via _checkGates().
   */
  confirmSelfDrivingHandoff(): void {
    this.$session.setKey('selfDrivingHandoffConfirmed', true);
    this.emitChange();
  }

  /**
   * Mark a composed run step complete (e.g. self-driving's `integrate-run`).
   * Records the step id so its `isComplete` predicate holds, clears the task
   * list, and resets run phase to Idle so the next run step starts fresh.
   */
  completeRunStep(stepId: string): void {
    const done = this.session.completedRuns;
    if (!done.includes(stepId)) {
      this.$session.setKey('completedRuns', [...done, stepId]);
    }
    this.$tasks.set([]);
    this.$session.setKey('runPhase', RunPhase.Idle);
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

  get tokenUsage(): TokenUsageSnapshot {
    return this.$tokenUsage.get();
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
    const cur = this.$tokenUsage.get();
    if (cur.costIsFinal) return;
    const deltaCostUsd = computeTokenCostUsd(delta);
    this.$tokenUsage.set({
      inputTokens: cur.inputTokens + delta.inputTokens,
      outputTokens: cur.outputTokens + delta.outputTokens,
      cacheReadTokens: cur.cacheReadTokens + delta.cacheReadTokens,
      cacheCreationTokens: cur.cacheCreationTokens + delta.cacheCreationTokens,
      costUsd: cur.costUsd + deltaCostUsd,
      costIsFinal: false,
    });
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
