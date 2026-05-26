import { appendFileSync } from 'fs';
import path from 'path';
import { getUI } from '@ui';
import { runtimeEnv } from '@env';
import { WIZARD_LOG_FILE } from './paths';

function formatLogValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack ?? '';
  return JSON.stringify(value, null, 2);
}

let debugEnabled = false;
let logFilePath = WIZARD_LOG_FILE;
let logEnabled = true;

export function getLogFilePath(): string {
  return logFilePath;
}

/**
 * Configure the log file path and enable/disable state.
 * Call before initLogFile() to override defaults.
 */
export function configureLogFile(opts: {
  path?: string;
  enabled?: boolean;
}): void {
  if (opts.path !== undefined) logFilePath = opts.path;
  if (opts.enabled !== undefined) logEnabled = opts.enabled;
}

/**
 * Configure log path from environment variables.
 *
 * Uses POSTHOG_WIZARD_LOG_DIR when set, joined with posthog-wizard.log.
 */
export function configureLogFileFromEnvironment(): void {
  const envLogDir = runtimeEnv('POSTHOG_WIZARD_LOG_DIR');
  if (envLogDir) {
    configureLogFile({ path: path.join(envLogDir, 'posthog-wizard.log') });
  }
}

/**
 * Initialize the log file with a run header.
 * Call this at the start of each wizard run.
 * Fails silently to avoid crashing the wizard.
 */
export function initLogFile() {
  if (!logEnabled) return;
  try {
    const header = `\n${'='.repeat(
      60,
    )}\nPostHog Wizard Run: ${new Date().toISOString()}\n${'='.repeat(60)}\n`;
    appendFileSync(logFilePath, header);
  } catch {
    // Silently ignore - logging is non-critical
  }
}

/**
 * Log a message to the log file.
 * Always writes regardless of debug flag (when logging is enabled).
 * Fails silently to avoid masking errors in catch blocks.
 */
export function logToFile(...args: unknown[]) {
  if (!logEnabled) return;
  try {
    const timestamp = new Date().toISOString();
    const msg = args.map((a) => formatLogValue(a)).join(' ');
    appendFileSync(logFilePath, `[${timestamp}] ${msg}\n`);
  } catch {
    // Silently ignore logging failures to avoid masking original errors
  }
}

export function debug(...args: unknown[]) {
  if (!debugEnabled) {
    return;
  }

  const msg = args.map((a) => formatLogValue(a)).join(' ');

  getUI().log.info(msg);
}

export function enableDebugLogs() {
  debugEnabled = true;
}
