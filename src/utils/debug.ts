import { AsyncLocalStorage } from 'node:async_hooks';
import chalk from 'chalk';
import { appendFileSync } from 'fs';
import { prepareMessage } from './logging';
import clack from './clack';

let debugEnabled = false;
let logFilePath = '/tmp/posthog-wizard.log';
let logEnabled = true;

/** Per-project log file scoping via withLogFile(). */
const logFileStore = new AsyncLocalStorage<{ logFilePath: string }>();

/** Get the effective log file path (scoped or global). */
export function getLogFilePath(): string {
  return logFileStore.getStore()?.logFilePath ?? logFilePath;
}

/** Configure the log file path and enable/disable state. */
export function configureLogFile(opts: {
  path?: string;
  enabled?: boolean;
}): void {
  if (opts.path !== undefined) logFilePath = opts.path;
  if (opts.enabled !== undefined) logEnabled = opts.enabled;
}

/** Write a run header to the log file. Fails silently. */
export function initLogFile() {
  if (!logEnabled) return;
  try {
    const effectivePath = getLogFilePath();
    const header = `\n${'='.repeat(
      60,
    )}\nPostHog Wizard Run: ${new Date().toISOString()}\n${'='.repeat(60)}\n`;
    appendFileSync(effectivePath, header);
  } catch {
    // Silently ignore - logging is non-critical
  }
}

/** Append a message to the log file. Fails silently. */
export function logToFile(...args: unknown[]) {
  if (!logEnabled) return;
  try {
    const effectivePath = getLogFilePath();
    const timestamp = new Date().toISOString();
    const msg = args.map((a) => prepareMessage(a)).join(' ');
    appendFileSync(effectivePath, `[${timestamp}] ${msg}\n`);
  } catch {
    // Silently ignore logging failures to avoid masking original errors
  }
}

/** Run `fn` with a scoped log file path. */
export function withLogFile<T>(path: string, fn: () => Promise<T>): Promise<T> {
  return logFileStore.run({ logFilePath: path }, fn);
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
