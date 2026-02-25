/**
 * WizardUI — abstraction layer for all user-facing operations.
 *
 * Business logic calls `getUI()` instead of importing Clack directly.
 * Implementations: ClackUI (legacy/CI), InkUI (TUI), ConsoleUI (CI).
 */

export interface SpinnerHandle {
  start(message?: string): void;
  stop(message?: string): void;
  message(msg?: string): void;
}

export interface SelectOption<T> {
  value: T;
  label: string;
  hint?: string;
}

export interface GroupMultiselectOptions<T> {
  message: string;
  options: Record<string, SelectOption<T>[]>;
  initialValues?: T[];
  required?: boolean;
}

export interface MultiselectOptions<T> {
  message: string;
  options: SelectOption<T>[];
  initialValues?: T[];
  required?: boolean;
}

export interface WizardUI {
  // Prompts (async, blocking)
  select<T>(opts: {
    message: string;
    options: SelectOption<T>[];
    initialValue?: T;
    maxItems?: number;
  }): Promise<T | symbol>;

  confirm(opts: {
    message: string;
    initialValue?: boolean;
  }): Promise<boolean | symbol>;

  text(opts: {
    message: string;
    placeholder?: string;
    validate?: (value: string) => string | void;
  }): Promise<string | symbol>;

  groupMultiselect<T>(opts: GroupMultiselectOptions<T>): Promise<T[] | symbol>;

  multiselect<T>(opts: MultiselectOptions<T>): Promise<T[] | symbol>;

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

  // Cancel detection
  isCancel(value: unknown): value is symbol;

  // Status push (for TUI status panel)
  pushStatus(message: string): void;

  // Screen transitions (TUI only, no-op for console)
  startRun(): void;

  // Todo tracking from SDK TodoWrite events
  syncTodos(
    todos: Array<{ content: string; status: string; activeForm?: string }>,
  ): void;
}
