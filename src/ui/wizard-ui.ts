/**
 * WizardUI — abstraction layer for all user-facing operations.
 *
 * Business logic calls `getUI()` instead of importing the store directly.
 * Implementations: InkUI (TUI), LoggingUI (CI).
 *
 * No prompt methods — the TUI screens own all user input.
 * Session-mutating methods trigger reactive screen resolution in the TUI.
 */

import type { SettingsConflict } from '../lib/agent/agent-interface';
import type { WizardReadinessResult } from '../lib/health-checks/readiness.js';
import type { OutroData } from '../lib/wizard-session';

export enum TaskStatus {
  Pending = 'pending',
  InProgress = 'in_progress',
  Completed = 'completed',
}

export function isTaskStatus(value: string): value is TaskStatus {
  return (Object.values(TaskStatus) as string[]).includes(value);
}

export interface SpinnerHandle {
  start(message?: string): void;
  stop(message?: string): void;
  message(msg?: string): void;
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

  showSettingsOverride(
    conflicts: SettingsConflict[],
    backupAndFix: () => boolean,
  ): Promise<void>;

  /** Show auth error overlay when Anthropic API returns 401. */
  showAuthError(): void;

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

  // ── Generic frameworkContext setter for workflow file watchers ─────
  setFrameworkContext(key: string, value: unknown): void;
}
