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

/**
 * Append to the log file, creating its directory on the first failure — the
 * log lives in the temp dir, which is not guaranteed to exist (Windows %TEMP%
 * can point at an uncreated per-user folder, and POSTHOG_WIZARD_LOG_DIR may
 * name a directory nobody made). Without this every logToFile call fails
 * silently and the run leaves no log at all.
 */
function appendLine(text: string): void {
  try {
    appendFileSync(logFilePath, text);
  } catch {
    if (ensuredLogDir) return;
    ensuredLogDir = true;
    try {
      mkdirSync(path.dirname(logFilePath), { recursive: true });
      appendFileSync(logFilePath, text);
    } catch {
      // Logging must never crash the wizard.
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
