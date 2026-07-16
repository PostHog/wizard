/**
 * JSON file watcher shared by runner and UI machinery.
 *
 * `fs.watch` alone is unreliable for atomic-rename writes, so the watcher
 * pairs it with a continuous mtime-polled re-read. The poll catches missed
 * events; the watch keeps latency low when it does fire.
 */

import * as fs from 'fs';

const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_ATTACH_RETRY_INTERVAL_MS = 1000;

export interface FileWatcherHandle {
  stop(): void;
}

export interface FileWatcherOptions {
  /** ms between mtime checks once the file exists. */
  pollIntervalMs?: number;
  /** ms between attach attempts while waiting for the file to appear. */
  attachRetryIntervalMs?: number;
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

  const watchers: fs.FSWatcher[] = [];
  const intervals: Array<ReturnType<typeof setInterval>> = [];
  let lastMtimeMs = 0;

  const read = (force = false) => {
    try {
      const stat = fs.statSync(path);
      if (!force && stat.mtimeMs === lastMtimeMs) return;
      lastMtimeMs = stat.mtimeMs;
      const parsed: unknown = JSON.parse(fs.readFileSync(path, 'utf-8'));
      onUpdate(parsed);
    } catch {
      // File missing or not yet valid JSON.
    }
  };

  intervals.push(setInterval(() => read(), pollIntervalMs));

  try {
    watchers.push(fs.watch(path, () => read(true)));
    read(true);
  } catch {
    // File doesn't exist yet — retry attaching the watch periodically until
    // it appears. The poll above already covers updates; this just upgrades
    // latency once the file shows up.
    const attachInterval = setInterval(() => {
      try {
        fs.accessSync(path);
        clearInterval(attachInterval);
        const idx = intervals.indexOf(attachInterval);
        if (idx >= 0) intervals.splice(idx, 1);
        watchers.push(fs.watch(path, () => read(true)));
        read(true);
      } catch {
        // Still waiting.
      }
    }, attachRetryIntervalMs);
    intervals.push(attachInterval);
  }

  return {
    stop() {
      for (const watcher of watchers) watcher.close();
      for (const interval of intervals) clearInterval(interval);
    },
  };
}
