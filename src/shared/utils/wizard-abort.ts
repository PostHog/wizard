/**
 * Single exit point for the wizard. Use instead of process.exit() directly.
 *
 * Sequence: cleanup -> error capture (optional) -> analytics shutdown -> outro -> process.exit
 *
 * A user cancel (ctrl+c, SIGINT, SIGTERM, SIGHUP) exits through `wizardCancel`, with no outro.
 *
 * WizardError (from `@lib/errors`) is a data carrier passed to wizardAbort() for analytics context, never thrown.
 * The legacy abort() in setup-utils.ts delegates here.
 */
import { constants } from 'os';
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

const CANCEL_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
type CancelSignal = (typeof CANCEL_SIGNALS)[number];
/** Upper bound on the cancel hooks and the analytics flush, each. */
const CANCEL_STEP_TIMEOUT_MS = 2000;

const cancelHooks: Array<() => Promise<void> | void> = [];
let cancelling = false;

/** Async teardown that only a cancel runs, such as settling a task stream. Returns the remover. */
export function registerCancelHook(fn: () => Promise<void> | void): () => void {
  cancelHooks.push(fn);
  return () => {
    const index = cancelHooks.indexOf(fn);
    if (index >= 0) cancelHooks.splice(index, 1);
  };
}

export function clearCancel(): void {
  cancelHooks.length = 0;
  cancelling = false;
}

const settleWithin = (work: Promise<unknown>, ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    void work
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timer);
        resolve();
      });
  });

/** The one exit for ctrl+c, SIGINT, SIGTERM and SIGHUP. A second cancel exits at once. */
export async function wizardCancel(
  source: CancelSignal | 'ctrl+c',
): Promise<never> {
  // The key is a SIGINT the terminal never sent, so it exits like one: 130.
  const signal = source === 'ctrl+c' ? 'SIGINT' : source;
  const exitCode = 128 + constants.signals[signal];
  if (cancelling) {
    logToFile(`[wizard-cancel] ${source} again, exiting now`);
    return process.exit(exitCode);
  }
  cancelling = true;
  logToFile(`[wizard-cancel] ${source}, cancelling`);

  // Sync first: a settings restore must not wait on the network.
  runCleanups();
  const hooks = cancelHooks.splice(0);
  await settleWithin(
    Promise.allSettled(hooks.map((hook) => Promise.resolve().then(hook))),
    CANCEL_STEP_TIMEOUT_MS,
  );
  await settleWithin(analytics.shutdown('cancelled'), CANCEL_STEP_TIMEOUT_MS);
  return process.exit(exitCode);
}

/** Routes SIGINT, SIGTERM and SIGHUP to `wizardCancel`. Returns the remover. */
export function installCancelSignals(): () => void {
  const handlers = CANCEL_SIGNALS.map((signal) => {
    const handler = () => void wizardCancel(signal);
    process.on(signal, handler);
    return { signal, handler };
  });
  return () => {
    for (const { signal, handler } of handlers) process.off(signal, handler);
  };
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

  // 2. Capture error in analytics. An 'error' ending with no Error object
  //    is captured as its code and message.
  const status = options?.status ?? (error ? 'error' : 'cancelled');
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
