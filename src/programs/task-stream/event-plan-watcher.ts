import type { WizardStore } from '@ui/tui/store';
import type { FileWatcherOptions } from '@lib/file-watcher';
import {
  ProgramEventPlanWatcher,
  normalizeEventPlan,
} from '../posthog-integration/watch-event-plan.js';

export { normalizeEventPlan };

/** Legacy store adapter; file watching belongs to the program. */
export class EventPlanWatcher {
  private readonly watcher: ProgramEventPlanWatcher;

  constructor(
    store: WizardStore,
    path: string,
    options: FileWatcherOptions = {},
  ) {
    this.watcher = new ProgramEventPlanWatcher(
      path,
      (events) => store.setEventPlan(events),
      options,
    );
  }

  start(): void {
    this.watcher.start();
  }

  refresh(): void {
    this.watcher.refresh();
  }

  stop(): void {
    this.watcher.stop();
  }
}
