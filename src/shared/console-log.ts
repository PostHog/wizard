/* eslint-disable no-console */
/** Console output with the wizard's glyphs, for commands and runs that print instead of drawing screens. */
import { emitWizardError, sanitizeErrorDetail } from './errors';
import type { ErrorCode } from './errors';
import type { OutroData } from './outro';

/** Where a console command prints: an intro and outro line, and one line per log call. */
export type ConsoleLog = {
  intro(message: string): void;
  outro(message: string): void;
  log: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    success(message: string): void;
    step(message: string): void;
  };
};

/** The printer every console command and headless's log lines share. */
export const consoleLog: ConsoleLog = {
  intro: (message) => console.log(`┌  ${message}`),
  outro: (message) => console.log(`└  ${message}`),
  log: {
    info: (message) => console.log(`│  ${message}`),
    warn: (message) => console.log(`▲  ${message}`),
    error: (message) => console.log(`✖  ${message}`),
    success: (message) => console.log(`✔  ${message}`),
    step: (message) => console.log(`◇  ${message}`),
  },
};

/** An abort's outro as console lines, then the machine-readable error line when it has a code. Resolves at once. */
export function printAbortOutro(
  outro: OutroData,
  report: {
    code?: ErrorCode;
    message: string;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  console.log(`✖  ${outro.message ?? 'Wizard aborted'}`);
  if (outro.body) console.log(`│  ${outro.body}`);
  if (outro.docsUrl) console.log(`│  Docs: ${outro.docsUrl}`);
  if (report.code) {
    emitWizardError({
      code: report.code,
      message: outro.message ?? report.message,
      detail: sanitizeErrorDetail(outro.errorDetail ?? report.detail),
    });
  }
  return Promise.resolve();
}
