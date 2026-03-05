/**
 * LogViewer — Real-time log tail, pinned to available terminal height.
 * Only renders the last N lines that fit on screen.
 */

import { Box, Text } from 'ink';
import { useState, useEffect } from 'react';
import * as fs from 'fs';
import { useStdoutDimensions } from '../hooks/useStdoutDimensions.js';

/** Rows consumed by TitleBar + spacer + ScreenContainer padding + status bar + tab bar */
const CHROME_ROWS = 8;

interface LogViewerProps {
  filePath: string;
  /** Fixed visible height. Defaults to terminal rows minus chrome. */
  height?: number;
}

export const LogViewer = ({ filePath, height }: LogViewerProps) => {
  const [, rows] = useStdoutDimensions();
  const visibleLines = height ?? Math.max(5, rows - CHROME_ROWS);

  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    const readTail = () => {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const allLines = content.split('\n');
        setLines(allLines.slice(-visibleLines));
      } catch {
        setLines(['(No log file found)']);
      }
    };

    readTail();

    let watcher: fs.FSWatcher | undefined;
    try {
      watcher = fs.watch(filePath, () => {
        readTail();
      });
    } catch {
      // File might not exist yet — retry when it appears
      const interval = setInterval(() => {
        try {
          fs.accessSync(filePath);
          readTail();
          clearInterval(interval);
          watcher = fs.watch(filePath, () => readTail());
        } catch {
          // Still waiting
        }
      }, 1000);

      return () => clearInterval(interval);
    }

    return () => {
      watcher?.close();
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
