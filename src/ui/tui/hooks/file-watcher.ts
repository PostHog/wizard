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
import { analytics } from '@utils/analytics';

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

  const read = (force = false) => {
    try {
      const stat = fs.statSync(path);
      if (!force && stat.mtimeMs === lastMtimeMs) return;
      lastMtimeMs = stat.mtimeMs;
      const parsed: unknown = JSON.parse(fs.readFileSync(path, 'utf-8'));
      onUpdate(parsed);
    } catch (err) {
      analytics.captureException(
        err instanceof Error ? err : new Error(String(err)),
        { step: 'file_watcher_read' },
      );
      // File missing or not yet valid JSON.
    }
  };

  intervals.push(setInterval(() => read(), pollIntervalMs));

  try {
    watchers.push(fs.watch(path, () => read(true)));
    read(true);
  } catch (err) {
    analytics.captureException(
      err instanceof Error ? err : new Error(String(err)),
      { step: 'start_file_watcher' },
    );
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
      } catch (err) {
        analytics.captureException(
          err instanceof Error ? err : new Error(String(err)),
          { step: 'start_file_watcher' },
        );
        // Still waiting.
      }
    }, attachRetryIntervalMs);
    intervals.push(attachInterval);
  }

  return {
    stop() {
      for (const w of watchers) w.close();
      for (const i of intervals) clearInterval(i);
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
