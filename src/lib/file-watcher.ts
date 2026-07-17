/**
 * JSON file watcher shared by runner and UI machinery.
 *
 * `fs.watch` alone is unreliable for atomic-rename writes, so the watcher
 * pairs it with a continuous mtime-polled re-read. The poll catches missed
 * events; the watch keeps latency low when it does fire.
 */

import * as fs from 'fs';
import { basename, dirname } from 'node:path';
import { logToFile } from '@utils/debug';

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
  /** Ignore the file that exists when the watcher starts until it changes. */
  ignoreInitialFile?: boolean;
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
  let ignoredInitialSignature: string | null = null;
  let watchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastReadErrorSignature: string | null = null;
  let stopped = false;

  const signature = (stat: fs.Stats): string =>
    `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;

  if (options.ignoreInitialFile) {
    try {
      const stat = fs.lstatSync(path);
      if (stat.isFile() && !stat.isSymbolicLink()) {
        ignoredInitialSignature = signature(stat);
      }
    } catch {
      // No initial file to ignore.
    }
  }

  const logReadError = (errorSignature: string, message: string) => {
    if (lastReadErrorSignature === errorSignature) return;
    lastReadErrorSignature = errorSignature;
    logToFile(`[file-watcher] ${message}: ${path}`);
  };

  const read = (force = false) => {
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(path);
    } catch {
      return;
    }

    if (!stat.isFile() || stat.isSymbolicLink()) return;
    const fileSignature = signature(stat);

    try {
      if (ignoredInitialSignature) {
        if (fileSignature === ignoredInitialSignature) return;
        ignoredInitialSignature = null;
      }
      if (
        options.maxFileSizeBytes !== undefined &&
        stat.size > options.maxFileSizeBytes
      ) {
        logReadError(
          `oversized:${fileSignature}`,
          `refusing oversized JSON file (${stat.size} bytes, limit ${options.maxFileSizeBytes} bytes)`,
        );
        return;
      }
      if (!force && stat.mtimeMs === lastMtimeMs) return;
      lastMtimeMs = stat.mtimeMs;
      const parsed: unknown = JSON.parse(fs.readFileSync(path, 'utf-8'));
      lastReadErrorSignature = null;
      onUpdate(parsed);
    } catch (error) {
      logReadError(
        `invalid:${fileSignature}:${String(error)}`,
        `could not read valid JSON (${String(error)})`,
      );
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
    // Defer the initial callback until the caller has received the handle, so
    // callbacks that stop their watcher cannot race handle assignment.
    queueMicrotask(() => {
      if (!stopped) read(true);
    });
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
