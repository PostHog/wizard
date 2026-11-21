import type { PlannedEvent, SessionStore } from '../session-store';
import {
  startFileWatcher,
  type FileWatcherHandle,
  type FileWatcherOptions,
} from '@utils/file-watcher';

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
  private captured = false;
  /** The path the running watcher reads. */
  private watching: string | null = null;

  constructor(
    private readonly store: SessionStore,
    /** The plan file. A function is read again by {@link follow}, for a run whose directory can move. */
    private readonly path: string | (() => string),
    private readonly options: FileWatcherOptions = {},
  ) {}

  private resolvePath(): string {
    return typeof this.path === 'function' ? this.path() : this.path;
  }

  start(): void {
    if (this.handle || this.captured) return;

    this.watching = this.resolvePath();
    this.handle = startFileWatcher(
      this.watching,
      (parsed) => {
        const events = normalizeEventPlan(parsed);
        if (!events || events.length === 0) return;

        this.captured = true;
        this.store.setEventPlan(events);
        this.stop();
      },
      {
        ignoreInitialFile: true,
        maxFileSizeBytes: MAX_EVENT_PLAN_FILE_BYTES,
        ...this.options,
      },
    );
  }

  /** Watch the plan file where it is now, when the run moved to another project's directory. */
  follow(): void {
    if (this.captured || !this.handle) return;
    if (this.resolvePath() === this.watching) return;
    this.stop();
    this.start();
  }

  refresh(): void {
    if (this.captured) return;
    this.handle?.refresh();
  }

  stop(): void {
    this.handle?.stop();
    this.handle = null;
  }
}
