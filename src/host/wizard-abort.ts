/**
 * How a run ends: the host ends the run; only the CLI exits. A host starts its
 * exit with `startHostExit`, and `wizardAbort` hands a decided failure's code to it.
 *
 * Sequence: cleanup -> shutdown hooks -> error capture (optional) -> analytics shutdown -> outro -> the host's exit
 *
 * WizardError (from `@shared/errors`) is a data carrier passed to wizardAbort() for analytics context, never thrown.
 * It lives in the host layer: the TUI, headless and the CLI may end a run; programs and the agent may not.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';
import { OutroKind, type OutroData } from '@shared/outro';
import type { ErrorCode } from '@shared/errors';
import { WizardError } from '@shared/errors';
import { clearCleanups, runCleanups } from '@utils/cleanup';

// Still importable from here; the class lives with the error codes.
export { WizardError };

export interface WizardAbortOptions {
  message?: string;
  /** Structured error data for the outro; built from `message` when absent. */
  outroData?: OutroData;
  error?: Error | WizardError;
  exitCode?: number;
  code?: ErrorCode;
  detail?: Record<string, unknown>;
  /** Terminal analytics status. Defaults from whether `error` is set. */
  status?: 'error' | 'cancelled';
}

/**
 * Shows an abort's outro, waits for the user to dismiss it, and emits the
 * machine-readable error line where the host calls for one. Each caller passes
 * its host's presenter to `wizardAbort`, so nothing looks the UI up.
 */
export type AbortPresenter = (
  outro: OutroData,
  report: {
    code?: ErrorCode;
    message: string;
    detail?: Record<string, unknown>;
  },
) => Promise<void>;

/** A host's end: the first `end` or `fail` wins, and `exited` settles with it. */
export interface HostExit {
  readonly exited: Promise<number>;
  end(code: number): void;
  fail(error: unknown): void;
  readonly ended: boolean;
}

let endRun: ((code: number) => void) | null = null;

/** Start a host's exit, and make it the one `wizardAbort` hands its code to. */
export function startHostExit(): HostExit {
  let resolve!: (code: number) => void;
  let reject!: (error: unknown) => void;
  const exited = new Promise<number>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  let ended = false;
  const exit: HostExit = {
    exited,
    end(code) {
      if (ended) return;
      ended = true;
      resolve(code);
    },
    fail(error) {
      if (ended) return;
      ended = true;
      reject(error);
    },
    get ended() {
      return ended;
    },
  };
  endRun = (code) => exit.end(code);
  return exit;
}

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

export function clearCleanup(): void {
  clearCleanups();
  shutdownFns.clear();
}

function resolveErrorCode(
  options: WizardAbortOptions,
  error: Error | WizardError | undefined,
): ErrorCode | undefined {
  if (options.code) return options.code;
  if (error instanceof WizardError) return error.code;
  return undefined;
}

/** A decided failure inside a controlled request: the request fails, the process keeps serving. */
export class ControlledAbortError extends Error {
  constructor(readonly failure: WizardAbortOptions | undefined) {
    super(failure?.message ?? 'The run ended with a decided failure.');
    this.name = 'ControlledAbortError';
  }
}

const controlled = new AsyncLocalStorage<true>();

/**
 * Run `fn` so a `wizardAbort` inside it rejects with `ControlledAbortError`
 * instead of ending the run. The control server wraps each request in it.
 */
export function withControlledAbort<T>(fn: () => Promise<T>): Promise<T> {
  return controlled.run(true, fn);
}

/** End the run with a decided failure: show its outro through `present`, then hand its code to the host. */
export async function wizardAbort(
  present: AbortPresenter,
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
  if (controlled.getStore()) throw new ControlledAbortError(options);
  const end = endRun;
  if (!end) throw new Error('wizardAbort ran outside a host');

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

  // 4. Show the error outro through the host's presenter. Synthesize OutroData
  //    from `message` when the caller didn't provide structured data.
  const resolvedOutroData: OutroData = outroData ?? {
    kind: OutroKind.Error,
    message,
  };
  if (code && resolvedOutroData.kind === OutroKind.Error) {
    resolvedOutroData.errorCode ??= code;
    if (detail) resolvedOutroData.errorDetail ??= detail;
  }
  await present(resolvedOutroData, { code, message, detail });

  // 5. Hand the code to the host and never settle, so nothing after an abort runs.
  end(exitCode);
  return new Promise<never>(() => undefined);
}
