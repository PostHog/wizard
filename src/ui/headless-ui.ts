import { LoggingUI } from './logging-ui';
import type { WizardStore } from './tui/store';

/**
 * `LoggingUI` plus it feeds run state into a `WizardStore` so the background
 * wizard-session sync (`TaskStreamPush`) can observe a headless run. We extend
 * `LoggingUI` (not `InkUI`) because its blocking/gate methods would wait on a
 * TUI that never renders; the runner drives phase transitions on the store
 * directly, so only the per-run updates (today: the task list) tee through here.
 * To stream more later, override `setEventPlan` / `setStage` the same way.
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
}
