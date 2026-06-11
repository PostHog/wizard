import { appendFileSync } from 'fs';
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
    // JSON.stringify returns undefined for functions/symbols/undefined and
    // throws on circular values — fall back to util.inspect so a crash log
    // line is never silently dropped.
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
  if (opts.path !== undefined) logFilePath = opts.path;
  if (opts.enabled !== undefined) fileLoggingEnabled = opts.enabled;
}

export function configureLogFileFromEnvironment(): void {
  const dir = runtimeEnv('POSTHOG_WIZARD_LOG_DIR');
  if (dir) {
    configureLogFile({ path: path.join(dir, 'posthog-wizard.log') });
  }
}

export function initLogFile(): void {
  if (!fileLoggingEnabled) return;
  try {
    const divider = '='.repeat(60);
    appendFileSync(
      logFilePath,
      `\n${divider}\nPostHog Wizard Run: ${new Date().toISOString()}\n${divider}\n`,
    );
  } catch {
    // Logging must never crash the wizard.
  }
}

export function logToFile(...args: unknown[]): void {
  if (!fileLoggingEnabled) return;
  try {
    const ts = new Date().toISOString();
    appendFileSync(logFilePath, `[${ts}] ${renderLine(args)}\n`);
  } catch {
    // Logging must never crash the wizard.
  }
}

export function debug(...args: unknown[]): void {
  if (!consoleLoggingEnabled) return;
  getUI().log.info(renderLine(args));
}

export function enableDebugLogs(): void {
  consoleLoggingEnabled = true;
}
