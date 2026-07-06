import { appendFileSync, mkdirSync } from 'fs';
import path from 'path';
import { inspect } from 'node:util';
import { getUI } from '@ui';
import { runtimeEnv } from '@env';
import { WIZARD_LOG_FILE } from './paths';

let logFilePath = WIZARD_LOG_FILE;
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
  }
  if (opts.enabled !== undefined) fileLoggingEnabled = opts.enabled;
}

let ensuredLogDir = false;
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
function appendLine(text: string): void {
  try {
    appendFileSync(logFilePath, text);
  } catch (err) {
    if (ensuredLogDir) {
      reportLogFailureOnce(err);
      return;
    }
    ensuredLogDir = true;
    try {
      mkdirSync(path.dirname(logFilePath), { recursive: true });
      appendFileSync(logFilePath, text);
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
  appendLine(`[${ts}] ${renderLine(args)}\n`);
}

export function debug(...args: unknown[]): void {
  if (!consoleLoggingEnabled) return;
  getUI().log.info(renderLine(args));
}

export function enableDebugLogs(): void {
  consoleLoggingEnabled = true;
}
