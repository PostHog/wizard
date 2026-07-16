/**
 * File watcher (UI concern).
 *
 * `fs.watch` alone is unreliable for atomic-rename writes (which is how Claude
 * rewrites JSON files), so the watcher pairs `fs.watch` with a continuous
 * mtime-polled re-read. The poll catches missed events; the watch keeps
 * latency low when it does fire. We dedupe with `mtimeMs` so steady-state
 * polls cost a single `stat`.
 *
 * Screens that need to mirror an agent-emitted JSON file into the store call
 * `useFileWatcher(absolutePath, onUpdate)`; the watcher starts on mount and
 * tears down on unmount.
 */

import * as fs from 'fs';
import { useEffect } from 'react';

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
 *  file's mtime changes and the contents are valid JSON. Caller must invoke
 *  `handle.stop()` to release the watcher. */
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
  // Once stopped, already-scheduled timer and watch callbacks must not touch
  // the path again — `clearInterval`/`close()` don't unqueue a callback that
  // already fired, and the path (or its directory) may vanish out from under a
  // straggler.
  let stopped = false;

  const read = (force = false) => {
    if (stopped) return;
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

  // Attach an `fs.watch` with an `'error'` handler. Without the handler a
  // watcher error (e.g. the watched path's directory is removed) is emitted on
  // an EventEmitter with no listener, which Node re-throws as an uncaught
  // exception. Returns true if the watch attached.
  const attachWatch = (): boolean => {
    try {
      const watcher = fs.watch(path, () => read(true));
      watcher.on('error', () => {
        // The watched path went away. Drop this watcher and swallow — the poll
        // loop keeps updates flowing and re-attach is handled elsewhere.
        try {
          watcher.close();
        } catch {
          // Already closed.
        }
      });
      watchers.push(watcher);
      return true;
    } catch {
      return false;
    }
  };

  intervals.push(setInterval(() => read(), pollIntervalMs));

  if (attachWatch()) {
    read(true);
  } else {
    // File doesn't exist yet — retry attaching the watch periodically until
    // it appears. The poll above already covers updates; this just upgrades
    // latency once the file shows up.
    const attachInterval = setInterval(() => {
      if (stopped) return;
      try {
        fs.accessSync(path);
      } catch {
        return; // Still waiting.
      }
      clearInterval(attachInterval);
      const idx = intervals.indexOf(attachInterval);
      if (idx >= 0) intervals.splice(idx, 1);
      attachWatch();
    }, attachRetryIntervalMs);
    intervals.push(attachInterval);
  }

  return {
    stop() {
      stopped = true;
      for (const i of intervals) clearInterval(i);
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          // Already closed.
        }
      }
    },
  };
}

/** React hook wrapping `startFileWatcher`. Starts on mount, stops on unmount
 *  or when `path` changes. `onUpdate` and `options` are captured at mount
 *  time — change `path` to restart with a new callback. */
export function useFileWatcher(
  path: string,
  onUpdate: (parsed: unknown) => void,
  options: FileWatcherOptions = {},
): void {
  useEffect(() => {
    const handle = startFileWatcher(path, onUpdate, options);
    return () => handle.stop();
    // `onUpdate` and `options` are intentionally omitted from deps — the
    // watcher captures them at mount time and the path drives restarts.
  }, [path]);
}
