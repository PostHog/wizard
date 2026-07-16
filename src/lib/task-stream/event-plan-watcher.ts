import { join } from 'node:path';
import type { PlannedEvent, WizardStore } from '@ui/tui/store';
import {
  startFileWatcher,
  type FileWatcherHandle,
  type FileWatcherOptions,
} from '@lib/file-watcher';
import { EVENT_PLAN_FILE } from '@lib/programs/posthog-integration/constants';

export function normalizeEventPlan(parsed: unknown): PlannedEvent[] | null {
  if (!Array.isArray(parsed)) return null;

  return parsed
    .map((value) => {
      const entry =
        value && typeof value === 'object'
          ? (value as Record<string, unknown>)
          : {};
      return {
        name: (entry.event_name ?? entry.name ?? entry.event ?? '') as string,
        description: (entry.event_description ??
          entry.description ??
          '') as string,
      };
    })
    .filter((event) => event.name);
}

export class EventPlanWatcher {
  private handle: FileWatcherHandle | null = null;

  constructor(
    private readonly store: WizardStore,
    private readonly options: FileWatcherOptions = {},
  ) {}

  start(): void {
    if (this.handle) return;

    const installDir = this.store.session.installDir;
    if (!installDir) return;

    const path = join(installDir, EVENT_PLAN_FILE);
    this.handle = startFileWatcher(
      path,
      (parsed) => {
        const events = normalizeEventPlan(parsed);
        if (events) this.store.setEventPlan(events);
      },
      this.options,
    );
  }

  stop(): void {
    this.handle?.stop();
    this.handle = null;
  }
}
