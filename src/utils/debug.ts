import { appendFileSync, existsSync, mkdirSync, statSync } from 'fs';
import path from 'path';
import { inspect } from 'node:util';
import { getUI } from '@ui';
import { IS_DEV, runtimeEnv } from '@env';
import { WIZARD_LOG_FILE } from './paths';

/** Soft ceiling for a single `logToFile` write (UTF-8 bytes). */
export const MAX_LOG_LINE_BYTES = 8 * 1024;

/** Soft ceiling for the whole wizard log file (UTF-8 bytes on disk). */
export const MAX_LOG_FILE_BYTES = 10 * 1024 * 1024;

// Dev builds may redirect the log so concurrent runs don't interleave one file.
let logFilePath =
  (IS_DEV && process.env.POSTHOG_WIZARD_LOG_FILE) || WIZARD_LOG_FILE;
let fileLoggingEnabled = true;
let consoleLoggingEnabled = false;

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack ?? String(value);
  try {
    // JSON.stringify throws on cycles and skips some values — fall back to
    // inspect so a crash log line is never dropped.
    return JSON.stringify(value, null, 2) ?? inspect(value, { depth: 3 });
  } catch {
    return inspect(value, { depth: 3 });
  }
}

function renderLine(args: readonly unknown[]): string {
  return args.map(stringify).join(' ');
}

/**
 * Truncate `text` so its UTF-8 byte length is at most `maxBytes`.
 * Exported for unit tests.
 */
export function capLogLine(
  text: string,
  maxBytes: number = MAX_LOG_LINE_BYTES,
): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  const marker = `… [truncated, ${Buffer.byteLength(
    text,
    'utf8',
  )} bytes total]`;
  const markerBytes = Buffer.byteLength(marker, 'utf8');
  if (markerBytes >= maxBytes) {
    // Pathological tiny cap — return a hard slice of the marker.
    return Buffer.from(marker, 'utf8').subarray(0, maxBytes).toString('utf8');
  }
  const budget = maxBytes - markerBytes;
  // Walk back from a char-index estimate until we fit the byte budget.
  let end = Math.min(text.length, budget);
  while (end > 0 && Buffer.byteLength(text.slice(0, end), 'utf8') > budget) {
    end -= 1;
  }
  return `${text.slice(0, end)}${marker}`;
}

export function getLogFilePath(): string {
  return logFilePath;
}

export function configureLogFile(opts: {
  path?: string;
  enabled?: boolean;
}): void {
  if (opts.path !== undefined) {
    logFilePath = opts.path;
    ensuredLogDir = false;
    logFileCapReached = false;
  }
  if (opts.enabled !== undefined) fileLoggingEnabled = opts.enabled;
}

let ensuredLogDir = false;
let reportedLogFailure = false;
let logFileCapReached = false;

// Failed log writes go to error tracking, once per process. Dynamic import:
// analytics logs through this module, so a static import would be a cycle.
function reportLogFailureOnce(err: unknown): void {
  if (reportedLogFailure) return;
  reportedLogFailure = true;
  void import('./analytics')
    .then(({ analytics }) =>
      analytics.captureException(
        err instanceof Error ? err : new Error(String(err)),
        {
          source: 'log-file-write',
          log_path: logFilePath,
          platform: process.platform,
        },
      ),
    )
    .catch(() => {
      // Reporting must never crash the wizard either.
    });
}

// The log's directory isn't guaranteed to exist (Windows %TEMP%,
// POSTHOG_WIZARD_LOG_DIR) — create it on first failure.
function appendLine(text: string): void {
  if (logFileCapReached) return;

  let toWrite = text;
  try {
    if (existsSync(logFilePath)) {
      const size = statSync(logFilePath).size;
      if (size >= MAX_LOG_FILE_BYTES) {
        logFileCapReached = true;
        return;
      }
      const writeBytes = Buffer.byteLength(toWrite, 'utf8');
      if (size + writeBytes > MAX_LOG_FILE_BYTES) {
        toWrite = capLogLine(toWrite, Math.max(0, MAX_LOG_FILE_BYTES - size));
        logFileCapReached = true;
      }
    }
    appendFileSync(logFilePath, toWrite);
  } catch (err) {
    if (ensuredLogDir) {
      reportLogFailureOnce(err);
      return;
    }
    ensuredLogDir = true;
    try {
      mkdirSync(path.dirname(logFilePath), { recursive: true });
      appendFileSync(logFilePath, toWrite);
    } catch (retryErr) {
      reportLogFailureOnce(retryErr);
    }
  }
}

export function configureLogFileFromEnvironment(): void {
  const dir = runtimeEnv('POSTHOG_WIZARD_LOG_DIR');
  if (dir) {
    configureLogFile({ path: path.join(dir, 'posthog-wizard.log') });
  }
}

export function initLogFile(): void {
  if (!fileLoggingEnabled) return;
  const divider = '='.repeat(60);
  appendLine(
    `\n${divider}\nPostHog Wizard Run: ${new Date().toISOString()}\n${divider}\n`,
  );
}

export function logToFile(...args: unknown[]): void {
  if (!fileLoggingEnabled) return;
  const ts = new Date().toISOString();
  const line = capLogLine(`[${ts}] ${renderLine(args)}\n`);
  appendLine(line);
}

export function debug(...args: unknown[]): void {
  if (!consoleLoggingEnabled) return;
  getUI().log.info(renderLine(args));
}

export function enableDebugLogs(): void {
  consoleLoggingEnabled = true;
}
