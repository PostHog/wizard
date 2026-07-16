import type { PlannedEvent, WizardStore } from '@ui/tui/store';
import {
  startFileWatcher,
  type FileWatcherHandle,
  type FileWatcherOptions,
} from '@lib/file-watcher';

const MAX_EVENT_PLAN_FILE_BYTES = 256 * 1024;
const MAX_EVENT_COUNT = 50;
const MAX_EVENT_NAME_LENGTH = 400;
const MAX_EVENT_DESCRIPTION_LENGTH = 4000;

function firstString(...values: unknown[]): string | null {
  const value = values.find((candidate) => typeof candidate === 'string');
  return typeof value === 'string' ? value : null;
}

export function normalizeEventPlan(parsed: unknown): PlannedEvent[] | null {
  if (!Array.isArray(parsed)) return null;

  const events: PlannedEvent[] = [];
  for (const value of parsed) {
    if (events.length >= MAX_EVENT_COUNT) break;

    const entry =
      value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : {};
    const name = firstString(entry.event_name, entry.name, entry.event);
    if (!name || !name.trim() || name.length > MAX_EVENT_NAME_LENGTH) continue;

    const description =
      firstString(entry.event_description, entry.description) ?? '';
    events.push({
      name,
      description: description.slice(0, MAX_EVENT_DESCRIPTION_LENGTH),
    });
  }

  return events;
}

export class EventPlanWatcher {
  private handle: FileWatcherHandle | null = null;

  constructor(
    private readonly store: WizardStore,
    private readonly path: string,
    private readonly startedAtMs: number,
    private readonly options: FileWatcherOptions = {},
  ) {}

  start(): void {
    if (this.handle) return;

    this.handle = startFileWatcher(
      this.path,
      (parsed) => {
        const events = normalizeEventPlan(parsed);
        if (events) this.store.setEventPlan(events);
      },
      {
        minMtimeMs: this.startedAtMs,
        maxFileSizeBytes: MAX_EVENT_PLAN_FILE_BYTES,
        ...this.options,
      },
    );
  }

  refresh(): void {
    this.handle?.refresh();
  }

  stop(): void {
    this.handle?.stop();
    this.handle = null;
  }
}
