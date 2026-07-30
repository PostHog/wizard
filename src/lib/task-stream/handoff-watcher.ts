import type { WizardStore } from '@ui/tui/store';
import {
  startFileWatcher,
  type FileWatcherHandle,
  type FileWatcherOptions,
} from '@lib/file-watcher';

const MAX_HANDOFF_FILE_BYTES = 256 * 1024;
// Character cap matching the backend serializer (MAX_HANDOFF_TEXT_LENGTH):
// an oversized push would 400 and, because the payload is a full-state
// snapshot, take every later session update down with it.
export const MAX_HANDOFF_TEXT_CHARS = 64 * 1024;

export function normalizeHandoffText(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  return raw.length > MAX_HANDOFF_TEXT_CHARS
    ? raw.slice(0, MAX_HANDOFF_TEXT_CHARS)
    : raw;
}

/**
 * Watches the program's report file (the handoff doc) and mirrors its
 * markdown into the store, from where the task-stream push publishes it as
 * `handoff_text`. Unlike the event plan, the report can be rewritten after
 * it first appears (follow-up features append to it), so the watcher keeps
 * running for the whole run instead of stopping at first capture.
 *
 * `ignoreInitialFile` keeps a stale report from a previous run out of the
 * session: only a file (re)written during this run counts.
 *
 * TODO(remove): this passive watcher is now a fallback. The `publish_handoff`
 * wizard tool (src/lib/wizard-tools/handoff.ts) captures the report
 * deterministically — it writes the file, sets handoff_text on the store, and
 * mirrors it into a notebook in one host-side call. Once every program's
 * skill content calls that tool, the watcher (and the force-read in
 * TaskStreamPush.shutdown) can be deleted in favor of the tool being the
 * sole capture path.
 */
export class HandoffWatcher {
  private handle: FileWatcherHandle | null = null;

  constructor(
    private readonly store: WizardStore,
    private readonly path: string,
    private readonly options: FileWatcherOptions = {},
  ) {}

  start(): void {
    if (this.handle) return;

    this.handle = startFileWatcher(
      this.path,
      (raw) => {
        const text = normalizeHandoffText(raw);
        if (text === null) return;
        this.store.setHandoffText(text);
      },
      {
        format: 'text',
        ignoreInitialFile: true,
        maxFileSizeBytes: MAX_HANDOFF_FILE_BYTES,
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
