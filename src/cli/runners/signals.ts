/** The CLI owns the process: SIGINT and SIGTERM abort the host's signal, and the host's code is the exit. */
import { ErrorCodes, emitWizardError } from '@shared/errors';

/**
 * Exit with the code `run` resolves; the only way a host's run ends the
 * process. A rejection prints the PHW error line and exits 1.
 */
export function exitWith(run: () => Promise<number>): void {
  void run().then(
    (code) => process.exit(code),
    (error: unknown) => {
      emitWizardError({
        code: ErrorCodes.InternalUnhandled,
        message: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    },
  );
}

/**
 * Run a host with a signal SIGINT and SIGTERM abort (the reason is the signal
 * name), and settle as it does. The listeners go once it settles, so what runs
 * after it, such as a fallback with no screens, ends on Ctrl-C as Node does.
 */
export async function underSignals(
  run: (signal: AbortSignal) => Promise<number>,
): Promise<number> {
  const controller = new AbortController();
  const onSignal = (name: NodeJS.Signals) => controller.abort(name);
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  try {
    return await run(controller.signal);
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}

/** Run a host under the signals, then exit with the code it resolves. */
export function withSignals(
  run: (signal: AbortSignal) => Promise<number>,
): void {
  exitWith(() => underSignals(run));
}
