/**
 * Single exit point for the wizard. Use instead of process.exit() directly.
 *
 * Sequence: cleanup -> error capture (optional) -> analytics shutdown -> outro -> process.exit
 *
 * WizardError is a data carrier passed to wizardAbort() for analytics context, never thrown.
 * The legacy abort() in setup-utils.ts delegates here.
 */
import { analytics } from './analytics';
import { logToFile } from './debug';
import { getUI } from '@ui';
import { OutroKind, type OutroData } from '@lib/wizard-session';

export class WizardError extends Error {
  constructor(
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'WizardError';
  }
}

interface WizardAbortOptions {
  message?: string;
  /** Structured error data. Renders via `outroError` instead of `outro`. */
  outroData?: OutroData;
  error?: Error | WizardError;
  exitCode?: number;
  /**
   * Terminal status for `setup wizard finished`. Defaults to `error` when an
   * `error` is supplied and `cancelled` otherwise. Pass `not_applicable` for a
   * run that worked but found nothing to act on, so it isn't counted as a
   * failed run.
   */
  status?: 'error' | 'cancelled' | 'not_applicable';
}

const cleanupFns: Array<() => void> = [];

export function registerCleanup(fn: () => void): void {
  cleanupFns.push(fn);
}

export function clearCleanup(): void {
  cleanupFns.length = 0;
}

/** Runs all registered cleanup functions and drains the array. */
export function runCleanups(): void {
  const fns = cleanupFns.splice(0);
  for (const fn of fns) {
    try {
      fn();
    } catch {
      /* cleanup should not prevent exit */
    }
  }
}

export async function wizardAbort(
  options?: WizardAbortOptions,
): Promise<never> {
  const {
    message = 'Wizard setup cancelled.',
    outroData,
    error,
    exitCode = 1,
    status,
  } = options ?? {};

  logToFile(`[wizard-abort] exitCode=${exitCode}, message: ${message}`);
  if (error) {
    logToFile('[wizard-abort] error:', error);
  }

  // 1. Run registered cleanup functions
  runCleanups();

  // 2. Capture error in analytics (if provided)
  if (error) {
    analytics.captureException(error, {
      ...((error instanceof WizardError && error.context) || {}),
    });
  }

  // 3. Shutdown analytics
  await analytics.shutdown(status ?? (error ? 'error' : 'cancelled'));

  // 4. Render the error outro. Synthesize OutroData from `message`
  //    when the caller didn't provide structured data.
  const ui = getUI();
  ui.outroError(outroData ?? { kind: OutroKind.Error, message });

  // 5. Wait for the user to dismiss the outro screen. In a TUI this gives
  //    them time to read the error; in non-TUI environments it resolves
  //    immediately.
  await ui.waitForOutroDismissed();

  // 6. Exit (fires 'exit' event so TUI cleanup runs)
  return process.exit(exitCode);
}
