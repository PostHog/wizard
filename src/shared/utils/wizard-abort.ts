/**
 * Single exit point for the wizard. Use instead of process.exit() directly.
 *
 * Sequence: cleanup -> error capture (optional) -> analytics shutdown -> outro -> process.exit
 *
 * WizardError (from `@lib/errors`) is a data carrier passed to wizardAbort() for analytics context, never thrown.
 * The legacy abort() in setup-utils.ts delegates here.
 */
import { analytics } from './analytics';
import { logToFile } from './debug';
import { getUI } from '@ui';
import { LoggingUI } from '@ui/logging-ui';
import { OutroKind, type OutroData } from '@lib/wizard-session';
import type { ErrorCode } from '@shared/errors';
import {
  WizardError,
  emitWizardError,
  sanitizeErrorDetail,
} from '@shared/errors';

// Still importable from here; the class lives with the error codes.
export { WizardError };

interface WizardAbortOptions {
  message?: string;
  /** Structured error data. Renders via `outroError` instead of `outro`. */
  outroData?: OutroData;
  error?: Error | WizardError;
  exitCode?: number;
  code?: ErrorCode;
  detail?: Record<string, unknown>;
  /** Terminal analytics status. Defaults from whether `error` is set. */
  status?: 'error' | 'cancelled';
}

const cleanupFns: Array<() => void> = [];
const shutdownFns = new Set<
  (outcome: 'failed' | 'cancelled') => Promise<void>
>();

export function registerShutdown(
  fn: (outcome: 'failed' | 'cancelled') => Promise<void>,
): () => void {
  shutdownFns.add(fn);
  return () => {
    shutdownFns.delete(fn);
  };
}

export function registerCleanup(fn: () => void): void {
  cleanupFns.push(fn);
}

export function clearCleanup(): void {
  cleanupFns.length = 0;
  shutdownFns.clear();
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

function resolveErrorCode(
  options: WizardAbortOptions,
  error: Error | WizardError | undefined,
): ErrorCode | undefined {
  if (options.code) return options.code;
  if (error instanceof WizardError) return error.code;
  return undefined;
}

export async function wizardAbort(
  options?: WizardAbortOptions,
): Promise<never> {
  const {
    message = 'Wizard setup cancelled.',
    outroData,
    error,
    exitCode = 1,
  } = options ?? {};

  const code = resolveErrorCode(options ?? {}, error);
  const detail = options?.detail;

  logToFile(
    `[wizard-abort] exitCode=${exitCode}, code=${
      code ?? 'none'
    }, message: ${message}`,
  );
  if (error) {
    logToFile('[wizard-abort] error:', error);
  }

  // 1. Run registered cleanup functions
  runCleanups();
  const status = options?.status ?? (error ? 'error' : 'cancelled');
  await Promise.allSettled(
    [...shutdownFns].map((fn) =>
      fn(status === 'cancelled' ? 'cancelled' : 'failed'),
    ),
  );

  // 2. Capture error in analytics. An 'error' ending with no Error object
  //    is captured as its code and message.
  const captured =
    error ??
    (status === 'error'
      ? new WizardError(message, undefined, code)
      : undefined);
  if (captured) {
    analytics.captureException(captured, {
      ...((captured instanceof WizardError && captured.context) || {}),
      ...(code ? { error_code: code } : {}),
    });
  }

  // 3. Shutdown analytics
  await analytics.shutdown(status);

  // 4. Render the error outro. Synthesize OutroData from `message`
  //    when the caller didn't provide structured data.
  const ui = getUI();
  const resolvedOutroData: OutroData = outroData ?? {
    kind: OutroKind.Error,
    message,
  };
  if (code && resolvedOutroData.kind === OutroKind.Error) {
    resolvedOutroData.errorCode ??= code;
    if (detail) resolvedOutroData.errorDetail ??= detail;
  }
  ui.outroError(resolvedOutroData);

  // 5. Wait for the user to dismiss the outro screen. In a TUI this gives
  //    them time to read the error; in non-TUI environments it resolves
  //    immediately.
  await ui.waitForOutroDismissed();

  // 6. Emit the machine-readable error line for non-interactive hosts
  //    (LoggingUI and its HeadlessUI subclass); the TUI never sees it.
  if (code && ui instanceof LoggingUI) {
    emitWizardError({
      code,
      message: resolvedOutroData.message ?? message,
      detail: sanitizeErrorDetail(resolvedOutroData.errorDetail ?? detail),
    });
  }

  // 7. Exit (fires 'exit' event so TUI cleanup runs)
  return process.exit(exitCode);
}
