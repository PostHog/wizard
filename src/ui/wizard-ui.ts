/**
 * WizardUI — abstraction layer for all user-facing operations.
 *
 * Business logic calls `getUI()` instead of importing the store directly.
 * Implementations: InkUI (TUI), LoggingUI (CI).
 *
 * No prompt methods — the TUI screens own all user input.
 * Session-mutating methods trigger reactive screen resolution in the TUI.
 */

import type { SettingsConflict } from '../lib/agent-interface';

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

  /** Show blocking service outage (pushes outage overlay in TUI). Blocks until dismissed. */
  showBlockingOutage(
    result: import('../lib/health-checks/readiness.js').WizardReadinessResult,
  ): Promise<void>;

  /** Store non-blocking readiness warnings (shown as Health tab in RunScreen). */
  setReadinessWarnings(
    result: import('../lib/health-checks/readiness.js').WizardReadinessResult,
  ): void;

  /** Warn that another process is blocking the OAuth port (pushes overlay in TUI). */
  showPortConflict(processInfo: {
    command: string;
    pid: string;
    user: string;
  }): Promise<void>;

  showSettingsOverride(
    conflicts: SettingsConflict[],
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
