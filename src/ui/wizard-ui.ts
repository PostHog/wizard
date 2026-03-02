/**
 * WizardUI — abstraction layer for all user-facing operations.
 *
 * Business logic calls `getUI()` instead of importing Clack directly.
 * Implementations: InkUI (TUI), LoggingUI (CI).
 *
 * No prompt methods — the TUI screens own all user input.
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
  // Lifecycle messages
  intro(message: string): void;
  outro(message: string): void;
  cancel(message: string): void;

  // Logging
  log: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    success(message: string): void;
    step(message: string): void;
  };

  note(message: string): void;

  // Spinner
  spinner(): SpinnerHandle;

  // Structured setup data (for TUI intro view)
  setSetupData(data: {
    wizardLabel?: string;
    detectedFramework?: string;
    betaNotice?: string;
    preRunNotice?: string;
    disclosure?: string;
  }): void;

  // Status push (for TUI status panel)
  pushStatus(message: string): void;

  // OAuth login URL display
  setLoginUrl(url: string | null): void;

  // Screen transitions (TUI only, no-op for console)
  showServiceStatus(data: { description: string; statusPageUrl: string }): void;
  startRun(): void;

  // Todo tracking from SDK TodoWrite events
  syncTodos(
    todos: Array<{ content: string; status: string; activeForm?: string }>,
  ): void;
}
