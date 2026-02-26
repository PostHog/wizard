/* eslint-disable no-console, @typescript-eslint/require-await */
/**
 * ConsoleUI — Minimal non-interactive implementation for CI mode.
 * Uses console.log with simple prefix icons. No dependencies.
 */

import {
  TaskStatus,
  type WizardUI,
  type SpinnerHandle,
  type SelectOption,
  type GroupMultiselectOptions,
  type MultiselectOptions,
} from './wizard-ui';

export class ConsoleUI implements WizardUI {
  async select<T>(opts: {
    message: string;
    options: SelectOption<T>[];
    initialValue?: T;
  }): Promise<T | symbol> {
    // Auto-resolve with initialValue or first option
    const value = opts.initialValue ?? opts.options[0]?.value;
    console.log(`◇  ${opts.message} → ${String(value)}`);
    return value;
  }

  async confirm(opts: {
    message: string;
    initialValue?: boolean;
  }): Promise<boolean | symbol> {
    const value = opts.initialValue ?? true;
    console.log(`◇  ${opts.message} → ${value ? 'Yes' : 'No'}`);
    return value;
  }

  async text(opts: {
    message: string;
    placeholder?: string;
  }): Promise<string | symbol> {
    console.log(`◇  ${opts.message} → (default)`);
    return opts.placeholder ?? '';
  }

  async groupMultiselect<T>(
    opts: GroupMultiselectOptions<T>,
  ): Promise<T[] | symbol> {
    const all = Object.values(opts.options).flat();
    const values = opts.initialValues ?? all.map((o) => o.value);
    console.log(`◇  ${opts.message} → [${values.length} selected]`);
    return values;
  }

  async multiselect<T>(opts: MultiselectOptions<T>): Promise<T[] | symbol> {
    const values = opts.initialValues ?? opts.options.map((o) => o.value);
    console.log(`◇  ${opts.message} → [${values.length} selected]`);
    return values;
  }

  setSetupData(data: {
    wizardLabel?: string;
    detectedFramework?: string;
    betaNotice?: string;
    preRunNotice?: string;
    disclosure?: string;
  }): void {
    if (data.wizardLabel) console.log(`┌  ${data.wizardLabel}`);
    if (data.detectedFramework)
      console.log(`✔  Detected integration: ${data.detectedFramework}`);
    if (data.betaNotice) console.log(`│  ${data.betaNotice}`);
    if (data.preRunNotice) console.log(`▲  ${data.preRunNotice}`);
    if (data.disclosure) console.log(`│  ${data.disclosure}`);
  }

  intro(message: string): void {
    console.log(`┌  ${message}`);
  }

  outro(message: string): void {
    console.log(`└  ${message}`);
  }

  cancel(message: string): void {
    console.log(`■  ${message}`);
  }

  log = {
    info(message: string): void {
      console.log(`│  ${message}`);
    },
    warn(message: string): void {
      console.log(`▲  ${message}`);
    },
    error(message: string): void {
      console.log(`✖  ${message}`);
    },
    success(message: string): void {
      console.log(`✔  ${message}`);
    },
    step(message: string): void {
      console.log(`◇  ${message}`);
    },
  };

  note(message: string): void {
    console.log(`│  ${message}`);
  }

  spinner(): SpinnerHandle {
    return {
      start(message?: string) {
        if (message) console.log(`◌  ${message}`);
      },
      stop(message?: string) {
        if (message) console.log(`●  ${message}`);
      },
      message(msg?: string) {
        if (msg) console.log(`◌  ${msg}`);
      },
    };
  }

  isCancel(_value: unknown): _value is symbol {
    return false; // CI never cancels
  }

  pushStatus(message: string): void {
    console.log(`◇  ${message}`);
  }

  setLoginUrl(url: string | null): void {
    if (url) {
      console.log(
        `│  If the browser didn't open automatically, use this link:`,
      );
      console.log(`│  ${url}`);
    }
  }

  showServiceStatus(data: {
    description: string;
    statusPageUrl: string;
  }): void {
    console.log(`▲  Claude/Anthropic services are experiencing issues.`);
    console.log(`│  Status: ${data.description}`);
    console.log(`│  Status page: ${data.statusPageUrl}`);
    console.log(
      `│  The wizard may not work reliably while services are affected.`,
    );
  }

  startRun(): void {
    // No-op in CI mode
  }

  syncTodos(
    todos: Array<{ content: string; status: string; activeForm?: string }>,
  ): void {
    const completed = todos.filter(
      (t) => t.status === TaskStatus.Completed,
    ).length;
    const inProgress = todos.find((t) => t.status === TaskStatus.InProgress);
    if (inProgress) {
      console.log(
        `◌  [${completed}/${todos.length}] ${
          inProgress.activeForm || inProgress.content
        }`,
      );
    }
  }
}
