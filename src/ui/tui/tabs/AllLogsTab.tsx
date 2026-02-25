/**
 * AllLogsTab — Tails /tmp/posthog-wizard.log in real time.
 */

import { Box, Text } from 'ink';
import { useState, useEffect } from 'react';
import * as fs from 'fs';

const LOG_PATH = '/tmp/posthog-wizard.log';
const MAX_LINES = 200;

interface AllLogsTabProps {
  store: unknown; // Receives store prop for consistency but doesn't use it
}

export const AllLogsTab = (_props: AllLogsTabProps) => {
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    const readTail = () => {
      try {
        const content = fs.readFileSync(LOG_PATH, 'utf-8');
        const allLines = content.split('\n');
        setLines(allLines.slice(-MAX_LINES));
      } catch {
        setLines(['(No log file found)']);
      }
    };

    readTail();

    let watcher: fs.FSWatcher | undefined;
    try {
      watcher = fs.watch(LOG_PATH, () => {
        readTail();
      });
    } catch {
      // File might not exist yet
    }

    return () => {
      watcher?.close();
    };
  }, []);

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1} overflow="hidden">
      {lines.map((line, i) => (
        <Text key={i} dimColor>
          {line}
        </Text>
      ))}
    </Box>
  );
};
