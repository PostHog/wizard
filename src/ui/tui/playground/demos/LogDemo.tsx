/**
 * LogDemo — Demonstrates LogViewer.
 * Writes demo log lines to a temp file, then tails it.
 */

import { Box, Text } from 'ink';
import { useEffect, useState } from 'react';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LogViewer } from '../../primitives/index.js';
import { Colors } from '../../styles.js';

const DEMO_LOG_PATH = path.join(os.tmpdir(), 'posthog-playground.log');

const LOG_MESSAGES = [
  '[info] Playground started',
  '[info] Initializing demo components...',
  '[debug] Loading primitives barrel export',
  '[info] ScreenContainer mounted',
  '[info] TabContainer initialized with 6 tabs',
  '[debug] LayoutDemo: hAlign=Left, vAlign=Top',
  '[info] NavigationDemo: screenStack depth = 1',
  '[warn] TabDemo: arrow key conflict with outer container',
  '[info] InputDemo: waiting for user selection',
  '[info] ProgressDemo: tick 0, cycling tasks',
  '[debug] LogViewer: watching file for changes',
  '[info] All demos loaded successfully',
];

export const LogDemo = () => {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Write initial log content
    fs.writeFileSync(DEMO_LOG_PATH, LOG_MESSAGES.join('\n') + '\n');
    setReady(true);

    // Append lines periodically
    let lineNum = LOG_MESSAGES.length;
    const timer = setInterval(() => {
      lineNum++;
      const msg = `[info] Demo log line #${lineNum} — ${new Date().toISOString()}\n`;
      fs.appendFileSync(DEMO_LOG_PATH, msg);
    }, 2000);

    return () => {
      clearInterval(timer);
      try {
        fs.unlinkSync(DEMO_LOG_PATH);
      } catch {
        // ignore
      }
    };
  }, []);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color={Colors.accent}>
        Log Demo
      </Text>
      <Text dimColor>Tailing {DEMO_LOG_PATH} (new line every 2s)</Text>
      <Box height={1} />
      {ready && <LogViewer filePath={DEMO_LOG_PATH} maxLines={15} />}
    </Box>
  );
};
