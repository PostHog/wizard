/**
 * WizardUI — abstraction layer for all user-facing operations.
 *
 * Business logic calls `getUI()` instead of importing the store directly.
 * Implementations: InkUI (TUI), LoggingUI (CI).
 *
 * No prompt methods — the TUI screens own all user input.
 * Session-mutating methods trigger reactive screen resolution in the TUI.
 */

export enum TaskStatus {
  Pending = 'pending',
  InProgress = 'in_progress',
  Completed = 'completed',
}

export interface SpinnerHandle {
  start(message?: string): void;
  stop(message?: string): void;
  message(msg?: string): void;
}

export interface WizardUI {
  // ── Lifecycle messages ────────────────────────────────────────────
  intro(message: string): void;
  outro(message: string): void;
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

  /** Show service degradation (pushes outage overlay in TUI). */
  showServiceStatus(data: { description: string; statusPageUrl: string }): void;

  /**
   * Show blocking readiness outage (critical services down).
   * Returns a promise that resolves when user chooses "Continue anyway".
   * Never resolves if user exits.
   */
  showReadinessOutage(info: {
    decision: 'yes' | 'no' | 'yes_with_warnings';
    reasons: string[];
    services: Array<{ label: string; status: 'healthy' | 'degraded' | 'down' }>;
    componentDetails?: Array<{
      serviceLabel: string;
      items: Array<{ name: string; status: string }>;
    }>;
    posthogSubItems?: Array<{ label: string; status: string }>;
  }): Promise<void>;

  /** Warn that .claude/settings.json overrides blocking env vars (pushes blocking overlay in TUI). */
  showSettingsOverride(
    keys: string[],
    backupAndFix: () => boolean,
  ): Promise<void>;

  // ── Display state ──────────────────────────────────────────────────
  /** Set the detected framework label (e.g., "Django with Wagtail CMS") */
  setDetectedFramework(label: string): void;

  /** Register a callback to run when the TUI transitions onto the given screen. */
  onEnterScreen(screen: string, fn: () => void): void;

  setLoginUrl(url: string | null): void;

  // ── Todo tracking from SDK TodoWrite events ───────────────────────
  syncTodos(
    todos: Array<{ content: string; status: string; activeForm?: string }>,
  ): void;

  // ── Event plan from .posthog-events.json ────────────────────
  setEventPlan(events: Array<{ name: string; description: string }>): void;
}
