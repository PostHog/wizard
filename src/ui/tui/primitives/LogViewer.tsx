/**
 * LogViewer — Real-time log tail.
 * Extracted from AllLogsTab.
 */

import { Box, Text } from 'ink';
import { useState, useEffect } from 'react';
import * as fs from 'fs';

interface LogViewerProps {
  filePath: string;
  maxLines?: number;
}

export const LogViewer = ({ filePath, maxLines = 200 }: LogViewerProps) => {
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    const readTail = () => {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const allLines = content.split('\n');
        setLines(allLines.slice(-maxLines));
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
      // File might not exist yet
    }

    return () => {
      watcher?.close();
    };
  }, [filePath, maxLines]);

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      {lines.map((line, i) => (
        <Text key={i} dimColor>
          {line}
        </Text>
      ))}
    </Box>
  );
};
