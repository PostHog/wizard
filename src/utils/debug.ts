import chalk from 'chalk';
import { appendFileSync } from 'fs';
import { prepareMessage } from './logging';
import clack from './clack';

let debugEnabled = false;

export const LOG_FILE_PATH = '/tmp/posthog-wizard.log';

/**
 * Initialize the log file with a run header.
 * Call this at the start of each wizard run.
 */
export function initLogFile() {
  const header = `\n${'='.repeat(
    60,
  )}\nPostHog Wizard Run: ${new Date().toISOString()}\n${'='.repeat(60)}\n`;
  appendFileSync(LOG_FILE_PATH, header);
}

/**
 * Log a message to the file at /tmp/posthog-wizard.log.
 * Always writes regardless of debug flag.
 */
export function logToFile(...args: unknown[]) {
  const timestamp = new Date().toISOString();
  const msg = args.map((a) => prepareMessage(a)).join(' ');
  appendFileSync(LOG_FILE_PATH, `[${timestamp}] ${msg}\n`);
}

export function debug(...args: unknown[]) {
  if (!debugEnabled) {
    return;
  }

  const msg = args.map((a) => prepareMessage(a)).join(' ');

  clack.log.info(chalk.dim(msg));
}

export function enableDebugLogs() {
  debugEnabled = true;
}
