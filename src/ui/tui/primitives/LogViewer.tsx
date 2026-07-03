/**
 * LogViewer — Real-time log tail, pinned to available terminal height.
 * Only renders the last N lines that fit on screen.
 *
 * Reads only the last TAIL_BYTES of the file on each refresh and throttles
 * fs.watch callbacks to one refresh per WATCH_THROTTLE_MS. Without this,
 * fs.readFileSync allocates a string the size of the entire log on every
 * append — during subagent fan-out that's tens of writes per second against
 * a log that grows into the hundreds of MB, producing OOM-grade allocation
 * pressure on V8's heap.
 */

import { Box, Text } from 'ink';
import { useState, useEffect } from 'react';
import * as fs from 'fs';
import { useStdoutDimensions } from '@ui/tui/hooks/useStdoutDimensions';

/** Rows consumed by TitleBar + spacer + ScreenContainer padding + status bar +
 *  tab bar, with a couple rows of headroom so the tail never crowds the status
 *  bar below it. */
const CHROME_ROWS = 10;

/** Bytes read from the end of the log per refresh — large enough to contain
 *  any practical visible window of lines, small enough to allocate cheaply. */
const TAIL_BYTES = 256 * 1024;

/** Minimum gap between watch-triggered refreshes. fs.watch fires on every
 *  append */
const WATCH_THROTTLE_MS = 250;

interface LogViewerProps {
  filePath: string;
  /** Fixed visible height. Defaults to terminal rows minus chrome. */
  height?: number;
}

function readTailLines(filePath: string, visibleLines: number): string[] {
  const stat = fs.statSync(filePath);
  if (stat.size === 0) return [];
  const start = Math.max(0, stat.size - TAIL_BYTES);
  const length = stat.size - start;
  const buf = Buffer.alloc(length);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buf, 0, length, start);
  } finally {
    fs.closeSync(fd);
  }
  let text = buf.toString('utf-8');
  if (start > 0) {
    const firstNewline = text.indexOf('\n');
    if (firstNewline >= 0) text = text.slice(firstNewline + 1);
  }
  return text.split('\n').slice(-visibleLines);
}

export const LogViewer = ({ filePath, height }: LogViewerProps) => {
  const [, rows] = useStdoutDimensions();
  const visibleLines = height ?? Math.max(5, rows - CHROME_ROWS);

  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    let lastReadAt = 0;
    let pendingTimer: ReturnType<typeof setTimeout> | undefined;

    const readTail = () => {
      try {
        setLines(readTailLines(filePath, visibleLines));
      } catch {
        setLines(['(No log file found)']);
      }
    };

    const scheduleRead = () => {
      const now = Date.now();
      const elapsed = now - lastReadAt;
      if (elapsed >= WATCH_THROTTLE_MS) {
        lastReadAt = now;
        readTail();
        return;
      }
      if (pendingTimer) return;
      pendingTimer = setTimeout(() => {
        pendingTimer = undefined;
        lastReadAt = Date.now();
        readTail();
      }, WATCH_THROTTLE_MS - elapsed);
    };

    readTail();
    lastReadAt = Date.now();

    let watcher: fs.FSWatcher | undefined;
    try {
      watcher = fs.watch(filePath, () => scheduleRead());
    } catch {
      const interval = setInterval(() => {
        // Probe with a *non-throwing* `existsSync` rather than `accessSync`:
        // the "file not there yet" state is expected on every tick until the
        // file appears, and a throw here gets picked up by exception
        // autocapture and reported as a spurious `$exception`.
        if (!fs.existsSync(filePath)) return; // Still waiting for the file.
        try {
          watcher = fs.watch(filePath, () => scheduleRead());
          readTail();
          clearInterval(interval);
        } catch {
          // Raced with the file disappearing; keep polling and retry.
        }
      }, 1000);

      return () => {
        clearInterval(interval);
        if (pendingTimer) clearTimeout(pendingTimer);
      };
    }

    return () => {
      watcher?.close();
      if (pendingTimer) clearTimeout(pendingTimer);
    };
  }, [filePath, visibleLines]);

  return (
    <Box flexDirection="column" height={visibleLines}>
      {lines.map((line, i) => (
        <Text key={i} dimColor wrap="truncate">
          {line}
        </Text>
      ))}
    </Box>
  );
};
