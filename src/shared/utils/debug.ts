import { appendFileSync, mkdirSync } from 'fs';
import path from 'path';
import { inspect } from 'node:util';
import { IS_DEV, runtimeEnv } from '@env';
import { WIZARD_LOG_FILE } from './paths';

// Dev builds may redirect the log so concurrent runs don't interleave one file.
let logFilePath =
  (IS_DEV && process.env.POSTHOG_WIZARD_LOG_FILE) || WIZARD_LOG_FILE;
let fileLoggingEnabled = true;
// An explicit --log-file wins over every later path change while pinned.
let logFilePinned = false;

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

/** One log line from `logToFile`-style arguments: strings as they are, errors as their stack, the rest as JSON. */
export function formatLogLine(...args: readonly unknown[]): string {
  return args.map(stringify).join(' ');
}

export function getLogFilePath(): string {
  return logFilePath;
}

export function configureLogFile(opts: {
  path?: string;
  enabled?: boolean;
  pin?: boolean;
}): void {
  if (opts.pin === false) logFilePinned = false;
  if (opts.path !== undefined && !logFilePinned) {
    logFilePath = opts.path;
    ensuredLogDir = false;
    usedPerUserLog = false;
  }
  if (opts.pin === true) logFilePinned = true;
  if (opts.enabled !== undefined) fileLoggingEnabled = opts.enabled;
}

let ensuredLogDir = false;
let usedPerUserLog = false;
let reportedLogFailure = false;

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
function writeLine(text: string): void {
  try {
    appendFileSync(logFilePath, text);
  } catch (err) {
    if (ensuredLogDir) throw err;
    ensuredLogDir = true;
    mkdirSync(path.dirname(logFilePath), { recursive: true });
    appendFileSync(logFilePath, text);
  }
}

function isPermissionError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EACCES' || code === 'EPERM';
}

// Another user can own the shared /tmp log; switch once to a per-user file beside it.
function usePerUserLog(): boolean {
  const uid = process.getuid?.();
  if (logFilePinned || usedPerUserLog || uid === undefined) return false;
  usedPerUserLog = true;
  const { dir, name, ext } = path.parse(logFilePath);
  logFilePath = path.join(dir, `${name}-${uid}${ext}`);
  return true;
}

function appendLine(text: string): void {
  try {
    writeLine(text);
  } catch (err) {
    if (!isPermissionError(err) || !usePerUserLog()) {
      reportLogFailureOnce(err);
      return;
    }
    try {
      appendFileSync(logFilePath, text);
    } catch (fallbackErr) {
      reportLogFailureOnce(fallbackErr);
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
  appendLine(`[${ts}] ${formatLogLine(...args)}\n`);
}
