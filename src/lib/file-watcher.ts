/**
 * JSON file watcher shared by runner and UI machinery.
 *
 * `fs.watch` alone is unreliable for atomic-rename writes, so the watcher
 * pairs it with a continuous mtime-polled re-read. The poll catches missed
 * events; the watch keeps latency low when it does fire.
 */

import * as fs from 'fs';
import { basename, dirname } from 'node:path';

const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_ATTACH_RETRY_INTERVAL_MS = 1000;
const DEFAULT_WATCH_DEBOUNCE_MS = 25;

export interface FileWatcherHandle {
  refresh(): void;
  stop(): void;
}

export interface FileWatcherOptions {
  /** ms between mtime checks once the file exists. */
  pollIntervalMs?: number;
  /** ms between attach attempts while waiting for the file to appear. */
  attachRetryIntervalMs?: number;
  /** ms to coalesce duplicate filesystem events. */
  watchDebounceMs?: number;
  /** Ignore files older than this timestamp. */
  minMtimeMs?: number;
  /** Refuse to read files larger than this many bytes. */
  maxFileSizeBytes?: number;
}

/** Watch `path` for JSON updates and call `onUpdate(parsed)` whenever the
 * file's mtime changes and the contents are valid JSON. Caller must invoke
 * `handle.stop()` to release the watcher. */
export function startFileWatcher(
  path: string,
  onUpdate: (parsed: unknown) => void,
  options: FileWatcherOptions = {},
): FileWatcherHandle {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const attachRetryIntervalMs =
    options.attachRetryIntervalMs ?? DEFAULT_ATTACH_RETRY_INTERVAL_MS;
  const watchDebounceMs = options.watchDebounceMs ?? DEFAULT_WATCH_DEBOUNCE_MS;

  const watchers: fs.FSWatcher[] = [];
  const intervals: Array<ReturnType<typeof setInterval>> = [];
  const targetDir = dirname(path);
  const targetName = basename(path);
  let lastMtimeMs = 0;
  let watchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const read = (force = false) => {
    try {
      const stat = fs.lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink()) return;
      if (
        options.minMtimeMs !== undefined &&
        stat.mtimeMs < options.minMtimeMs
      ) {
        return;
      }
      if (
        options.maxFileSizeBytes !== undefined &&
        stat.size > options.maxFileSizeBytes
      ) {
        return;
      }
      if (!force && stat.mtimeMs === lastMtimeMs) return;
      lastMtimeMs = stat.mtimeMs;
      const parsed: unknown = JSON.parse(fs.readFileSync(path, 'utf-8'));
      onUpdate(parsed);
    } catch {
      // File missing or not yet valid JSON.
    }
  };

  const scheduleRead = () => {
    if (stopped) return;
    if (watchDebounceTimer) clearTimeout(watchDebounceTimer);
    watchDebounceTimer = setTimeout(() => {
      watchDebounceTimer = null;
      read(true);
    }, watchDebounceMs);
  };

  const attachWatch = () => {
    watchers.push(
      fs.watch(targetDir, (_eventType, filename) => {
        if (filename == null || filename.toString() === targetName) {
          scheduleRead();
        }
      }),
    );
  };

  intervals.push(setInterval(() => read(), pollIntervalMs));

  try {
    attachWatch();
    read(true);
  } catch {
    // Parent directory does not exist yet. Polling still covers a later file;
    // retry attaching the low-latency directory watcher until it appears.
    const attachInterval = setInterval(() => {
      try {
        fs.accessSync(targetDir);
        clearInterval(attachInterval);
        const idx = intervals.indexOf(attachInterval);
        if (idx >= 0) intervals.splice(idx, 1);
        attachWatch();
        read(true);
      } catch {
        // Still waiting.
      }
    }, attachRetryIntervalMs);
    intervals.push(attachInterval);
  }

  return {
    refresh() {
      if (stopped) return;
      if (watchDebounceTimer) {
        clearTimeout(watchDebounceTimer);
        watchDebounceTimer = null;
      }
      read(true);
    },
    stop() {
      stopped = true;
      if (watchDebounceTimer) {
        clearTimeout(watchDebounceTimer);
        watchDebounceTimer = null;
      }
      for (const watcher of watchers) watcher.close();
      for (const interval of intervals) clearInterval(interval);
    },
  };
}
