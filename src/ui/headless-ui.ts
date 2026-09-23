import { LoggingUI } from './logging-ui';
import type { WizardStore } from './tui/store';

/**
 * `LoggingUI` plus it feeds run state into a `WizardStore` so the background
 * wizard-session sync (`TaskStreamPush`) can observe a headless run. We extend
 * `LoggingUI` (not `InkUI`) because its blocking/gate methods would wait on a
 * TUI that never renders; the runner drives phase transitions on the store
 * directly, so only UI-originated per-run updates tee through here. The audit
 * ledger arrives through `setFrameworkContext`, the seam every UI implements.
 */
export class HeadlessUI extends LoggingUI {
  constructor(private readonly store: WizardStore) {
    super();
  }

  syncTodos(
    todos: Array<{ content: string; status: string; activeForm?: string }>,
  ): void {
    super.syncTodos(todos);
    this.store.syncTodos(todos);
  }

  setHandoffText(text: string): void {
    this.store.setHandoffText(text);
  }

  setFrameworkContext(key: string, value: unknown): void {
    this.store.setFrameworkContext(key, value);
  }

  setEventPlan(events: Array<{ name: string; description: string }>): void {
    this.store.setEventPlan(events);
  }

  getFrameworkContext(key: string): unknown {
    return this.store.session.frameworkContext[key];
  }
}
