/**
 * WizardUI — abstraction layer for all user-facing operations.
 *
 * Business logic calls `getUI()` instead of importing the store directly.
 * Implementations: InkUI (TUI), LoggingUI (CI).
 *
 * No prompt methods — the TUI screens own all user input.
 * Session-mutating methods trigger reactive screen resolution in the TUI.
 */

import type { SettingsConflict } from '@lib/agent/claude-settings';
import type { WizardReadinessResult } from '@lib/health-checks/readiness';
import type { ApiUser } from '@lib/api';
import type {
  AskAnswers,
  OutroData,
  PendingQuestion,
} from '@lib/wizard-session';

export enum TaskStatus {
  Pending = 'pending',
  InProgress = 'in_progress',
  Completed = 'completed',
  Skipped = 'skipped',
}

export function isTaskStatus(value: string): value is TaskStatus {
  return (Object.values(TaskStatus) as string[]).includes(value);
}

/**
 * One assistant turn's token usage, for the hidden Ctrl+T token/cost HUD.
 * `model` is the model that produced *this* turn (e.g. the SDK's
 * `message.message.model`) — a subagent can run on a different model than
 * the main session, and some programs override to Haiku, so pricing must key
 * off the per-turn model rather than a single run-wide assumption. Omit only
 * when the caller genuinely has no model context (falls back to Sonnet
 * pricing — see `pricePerMtokForModel` in `@lib/agent/token-pricing`).
 */
export interface TokenUsageDelta {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cacheCreation5m: number;
  cacheCreation1h: number;
  model?: string;
}

export interface SpinnerHandle {
  start(message?: string): void;
  stop(message?: string): void;
  message(msg?: string): void;
}

/**
 * Context passed to `showAuthError` so the screen can pick the right copy.
 *
 * `hasSettingsConflict` is true when a Claude Code settings file (project,
 * project-local, the user's global config, or managed) actually overrides the
 * LLM Gateway auth. `conflicts` carries the exact files and keys so the screen
 * can name them. When there is no conflict, the 401 has a different cause (bad
 * PAT prefix, missing scope, expired key, region mismatch) and we should not
 * advise the user to log out of Claude Code.
 */
export interface AuthErrorDetail {
  hasSettingsConflict: boolean;
  conflicts?: SettingsConflict[];
  /**
   * True when the agent SDK authenticated from a stored Claude login
   * (`apiKeySource: "/login managed key"`) instead of the wizard's gateway
   * token — conflicting Anthropic credentials. Takes priority in the screen.
   */
  usingManagedLogin?: boolean;
  /** Human-readable places a conflicting Anthropic credential may live. */
  credentialPlaces?: string[];
  logFilePath: string;
}

export interface WizardUI {
  // ── Lifecycle messages ────────────────────────────────────────────
  intro(message: string): void;
  /** Success outro with a plain text message. */
  outro(message: string): void;
  /**
   * Error outro. Sets structured outroData and transitions run phase so
   * the router advances to the outro screen. Use for abort/failure paths
   * that need a custom error render — do NOT build the outroData by
   * mutating session directly (nanostore holds a shallow copy).
   */
  outroError(data: OutroData): void;
  /** Resolves when the user dismisses the outro screen (presses any key).
   *  Lets the abort path wait for the user to read the error before the
   *  process exits. Resolves immediately in non-TUI environments. */
  waitForOutroDismissed(): Promise<void>;
  cancel(message: string): void;

  // ── Logging ───────────────────────────────────────────────────────
  log: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    success(message: string): void;
    step(message: string): void;
  };

  note(message: string): void;
  pushStatus(message: string): void;

  // ── Spinner ───────────────────────────────────────────────────────
  spinner(): SpinnerHandle;

  // ── Session state (triggers reactive screen resolution in TUI) ────
  /** Signal that the main work (agent run) has started. */
  startRun(): void;

  /** Store OAuth/API credentials. Resolves past AuthScreen in TUI. */
  setCredentials(credentials: {
    accessToken: string;
    projectApiKey: string;
    host: string;
    projectId: number;
  }): void;

  /**
   * Persist the user's `role_at_organization` once it's been fetched from
   * `/api/users/@me/`. Drives role-tailored prompt suggestions on the
   * McpSuggestedPromptsScreen. Pass `null` to clear / when unknown.
   */
  setRoleAtOrganization(role: string | null): void;

  /**
   * Persist the full user payload from `/api/users/@me/` so downstream
   * screens can read account context (current org, team, plan, email,
   * preferences, etc.) without re-fetching. Pass `null` to clear or
   * when the request failed.
   */
  setApiUser(user: ApiUser | null): void;

  /**
   * Park until the org's AI opt-in gate clears
   * (`organization.is_ai_data_processing_approved === true`, or the
   * program never registered the gate — requiresAi: false / no auth
   * step / CI session). The agent runner awaits this after setApiUser
   * and BEFORE skill install or agent start: this is the enforcement
   * point that keeps source on the machine while the TUI shows
   * AiOptInRequiredScreen. Resolves immediately in non-TUI
   * environments (CI auto-consents to AI usage).
   */
  waitForAiOptIn(): Promise<void>;

  /** Show blocking service outage (pushes outage overlay in TUI). Blocks until dismissed. */
  showBlockingOutage(result: WizardReadinessResult): Promise<void>;

  /** Store non-blocking readiness warnings (shown as Health tab in RunScreen). */
  setReadinessWarnings(result: WizardReadinessResult): void;

  /** Warn that another process is blocking the OAuth port (pushes overlay in TUI). */
  showPortConflict(processInfo: {
    command: string;
    pid: string;
    port: number;
    user: string;
  }): Promise<void>;

  /**
   * Resolve with an OAuth authorization code the user enters by hand — the
   * fallback for headless/remote shells where the browser can't reach the
   * local callback server. The OAuth flow races this against the callback
   * server. Implementations that can't prompt (CI/logging) never resolve.
   */
  waitForManualAuthCode(): Promise<string>;

  showSettingsOverride(
    conflicts: SettingsConflict[],
    backupAndFix: () => boolean,
  ): Promise<void>;

  /** Show auth error overlay when Anthropic API returns 401. */
  showAuthError(detail?: AuthErrorDetail): void;

  /** Show the session-timeout overlay when the OAuth login window expires. */
  showSessionTimeout(): void;

  /**
   * Open the wizard_ask overlay and resolve with the user's answers.
   * Implementations that can't ask (CI/logging) reject so the bridge can
   * surface a clear "not available" error to the agent.
   */
  requestQuestion(question: PendingQuestion): Promise<AskAnswers>;

  // ── Display state ──────────────────────────────────────────────────
  /** Set the detected framework label (e.g., "Django with Wagtail CMS") */
  setDetectedFramework(label: string): void;

  /** Register a callback to run when the TUI transitions onto the given screen. */
  onEnterScreen(screen: string, fn: () => void): void;

  setLoginUrl(url: string | null): void;

  /** Direct PostHog authorize URL, shown in the manual-paste modal. */
  setAuthorizeUrl(url: string | null): void;

  // ── Task tracking from SDK TaskCreate/TaskUpdate events ───────────
  // Receives the full materialised task list each call. The caller (agent
  // loop) maintains a Map<taskId, …> from incremental Task* events and
  // re-emits the snapshot here, preserving the existing store semantics.
  syncTodos(
    todos: Array<{ content: string; status: string; activeForm?: string }>,
  ): void;

  // ── Event plan from .posthog-events.json ────────────────────
  setEventPlan(events: Array<{ name: string; description: string }>): void;

  // ── Dashboard URL emitted by the agent via [DASHBOARD_URL] marker ──
  setDashboardUrl(url: string): void;

  /** Current "stage of work" — derived from the active tool call. Drives the
   *  Visualizer tab's NOW PLAYING display. Pass an AgentPhase value. */
  setStage(stage: string): void;

  // ── Notebook URL emitted by the agent via [NOTEBOOK_URL] marker ──
  setNotebookUrl(url: string): void;

  /** Accumulate one assistant turn's token usage into the hidden Ctrl+T
   *  token/cost HUD's running estimate. No-op outside the TUI. */
  addTokenUsage(delta: TokenUsageDelta): void;

  /** Reconcile the HUD's running cost estimate to the SDK's authoritative
   *  `total_cost_usd` once the agent run completes. No-op outside the TUI. */
  setFinalTokenCostUsd(costUsd: number): void;

  // ── Outro payload built by agent-runner ──
  // Replaces the direct `session.outroData = X` mutation that breaks once
  // setKey-based store mutations have forked the session reference.
  setOutroData(data: OutroData): void;

  // ── Generic frameworkContext setter for program file watchers ─────
  setFrameworkContext(key: string, value: unknown): void;

  /** Read a frameworkContext value from the LIVE session (store may have
   * forked the reference the runner holds). Used by run configs to read
   * values written by post-auth screens (e.g. the source-maps picker). */
  getFrameworkContext(key: string): unknown;

  /** Park until the named program step's gate predicate flips true. Resolves
   * immediately if the step has no gate. Mirrors waitForAiOptIn for any
   * post-auth interactive step the agent run must wait on. */
  waitForGate(stepId: string): Promise<void>;
}
