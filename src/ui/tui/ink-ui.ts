/**
 * InkUI — Ink-backed implementation of WizardUI.
 *
 * Setup prompts auto-accept — the IntroScreen owns user-facing input.
 * Run phase is headless.
 */

import type {
  WizardUI,
  SpinnerHandle,
  SelectOption,
  GroupMultiselectOptions,
  MultiselectOptions,
} from '../wizard-ui.js';
import type { WizardStore } from './store.js';

// Strip ANSI escape codes (chalk formatting) from strings
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

const CANCEL = Symbol('cancel');

export class InkUI implements WizardUI {
  constructor(private store: WizardStore) {}

  // --- Prompt methods: auto-accept (screens own user input) ---

  select<T>(opts: {
    message: string;
    options: SelectOption<T>[];
    initialValue?: T;
    maxItems?: number;
  }): Promise<T | symbol> {
    // Screens own user input — auto-decline anything the business logic asks
    // during headless mode. Return last option (conventionally "No" / "Skip").
    if (opts.initialValue !== undefined)
      return Promise.resolve(opts.initialValue);
    if (opts.options.length > 0)
      return Promise.resolve(opts.options[opts.options.length - 1].value);
    return Promise.resolve(CANCEL);
  }

  confirm(_opts: {
    message: string;
    initialValue?: boolean;
  }): Promise<boolean | symbol> {
    return Promise.resolve(_opts.initialValue ?? false);
  }

  text(opts: {
    message: string;
    placeholder?: string;
    validate?: (value: string) => string | void;
  }): Promise<string | symbol> {
    return Promise.resolve(opts.placeholder ?? '');
  }

  groupMultiselect<T>(
    _opts: GroupMultiselectOptions<T>,
  ): Promise<T[] | symbol> {
    return Promise.resolve(_opts.initialValues ?? []);
  }

  multiselect<T>(_opts: MultiselectOptions<T>): Promise<T[] | symbol> {
    return Promise.resolve(_opts.initialValues ?? []);
  }

  // --- Lifecycle ---

  setSetupData(_data: {
    wizardLabel?: string;
    detectedFramework?: string;
    betaNotice?: string;
    preRunNotice?: string;
    disclosure?: string;
  }): void {
    // IntroScreen owns intro display — no-op
  }

  intro(message: string): void {
    this.store.pushStatus(message);
  }

  outro(message: string): void {
    this.store.pushStatus(stripAnsi(message));

    if (!this.store.outroData) {
      this.store.setOutroData({ kind: 'success', message: stripAnsi(message) });
    }
    // Route through McpScreen before showing the outro
    this.store.setScreen('mcp');
  }

  setLoginUrl(_url: string | null): void {
    // No-op — IntroScreen could display this if needed
  }

  showServiceStatus(data: {
    description: string;
    statusPageUrl: string;
  }): void {
    this.store.setServiceStatus(data);
    this.store.pushScreen('outage');
  }

  startRun(): void {
    this.store.setScreen('run');
  }

  cancel(message: string): void {
    this.store.pushStatus(message);
  }

  log = {
    info: (message: string): void => {
      this.store.pushStatus(message);
    },
    warn: (message: string): void => {
      this.store.pushStatus(message);
    },
    error: (message: string): void => {
      this.store.pushStatus(message);
    },
    success: (message: string): void => {
      this.store.pushStatus(message);
    },
    step: (message: string): void => {
      this.store.pushStatus(message);
    },
  };

  note(message: string): void {
    this.store.pushStatus(message);
  }

  spinner(): SpinnerHandle {
    return {
      start: (message?: string) => {
        if (message) this.store.pushStatus(message);
      },
      stop: (message?: string) => {
        if (message) this.store.pushStatus(message);
      },
      message: (msg?: string) => {
        if (msg) this.store.pushStatus(msg);
      },
    };
  }

  isCancel(value: unknown): value is symbol {
    return value === CANCEL;
  }

  pushStatus(message: string): void {
    this.store.pushStatus(message);
  }

  syncTodos(
    todos: Array<{ content: string; status: string; activeForm?: string }>,
  ): void {
    this.store.syncTodos(todos);
  }

  static get cancelSymbol(): symbol {
    return CANCEL;
  }
}
