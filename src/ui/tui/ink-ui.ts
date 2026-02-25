/**
 * InkUI — Ink-backed implementation of WizardUI.
 * Sets pendingPrompt in the store and returns a Promise for each prompt method.
 * React prompt components (rendered by StatusTab) resolve the Promise on user input.
 */

import type {
  WizardUI,
  SpinnerHandle,
  SelectOption,
  GroupMultiselectOptions,
  MultiselectOptions,
} from '../wizard-ui.js';
import type { WizardStore, PendingPrompt } from './store.js';

const CANCEL = Symbol('cancel');

// Strip ANSI escape codes (chalk formatting) from strings
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

export class InkUI implements WizardUI {
  constructor(private store: WizardStore) {}

  private prompt<T>(
    prompt: Omit<PendingPrompt<T>, 'resolve'>,
  ): Promise<T | symbol> {
    return new Promise((resolve) => {
      this.store.setPendingPrompt({
        ...prompt,
        resolve: resolve as (value: unknown) => void,
      });
    });
  }

  async select<T>(opts: {
    message: string;
    options: SelectOption<T>[];
    initialValue?: T;
    maxItems?: number;
  }): Promise<T | symbol> {
    return this.prompt<T>({
      type: 'select',
      message: opts.message,
      options: opts.options,
      initialValue: opts.initialValue,
      maxItems: opts.maxItems,
    });
  }

  async confirm(opts: {
    message: string;
    initialValue?: boolean;
  }): Promise<boolean | symbol> {
    return this.prompt<boolean>({
      type: 'confirm',
      message: opts.message,
      initialValue: opts.initialValue,
    });
  }

  async text(opts: {
    message: string;
    placeholder?: string;
    validate?: (value: string) => string | void;
  }): Promise<string | symbol> {
    return this.prompt<string>({
      type: 'text',
      message: opts.message,
      placeholder: opts.placeholder,
      validate: opts.validate,
    });
  }

  async groupMultiselect<T>(
    opts: GroupMultiselectOptions<T>,
  ): Promise<T[] | symbol> {
    // Cast through any: PendingPrompt<T[]> nesting doesn't align with generic T
    return this.prompt({
      type: 'groupMultiselect',
      message: opts.message,
      groupOptions: opts.options,
      initialValues: opts.initialValues,
      required: opts.required,
    } as any);
  }

  async multiselect<T>(opts: MultiselectOptions<T>): Promise<T[] | symbol> {
    return this.prompt({
      type: 'multiselect',
      message: opts.message,
      options: opts.options,
      initialValues: opts.initialValues,
      required: opts.required,
    } as any);
  }

  setSetupData(data: {
    wizardLabel?: string;
    detectedFramework?: string;
    betaNotice?: string;
    preRunNotice?: string;
    disclosure?: string;
  }): void {
    this.store.setIntro(data);
  }

  intro(message: string): void {
    this.store.pushStatus(message);
  }

  outro(message: string): void {
    // Always push to status so it's visible even if process.exit fires immediately
    this.store.pushStatus(stripAnsi(message));

    if (this.store.outroData) {
      this.store.setScreen('outro');
    } else {
      this.store.setOutroData({ kind: 'success', message: stripAnsi(message) });
      this.store.setScreen('outro');
    }
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
