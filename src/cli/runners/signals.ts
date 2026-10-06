/** The CLI owns the process: SIGINT, SIGTERM and SIGHUP abort the host's signal, and the host's code is the exit. */
import { ErrorCodes, emitWizardError } from '@shared/errors';

const drain = (stream: NodeJS.WriteStream): Promise<void> =>
  new Promise((resolve) => stream.write('', () => resolve()));

/** Exit once stdout and stderr have flushed, so a slow pipe keeps the whole output. */
async function flushThenExit(code: number): Promise<void> {
  await Promise.all([drain(process.stdout), drain(process.stderr)]);
  process.exit(code);
}

/**
 * Exit with the code `run` resolves; the only way a host's run ends the
 * process. A rejection prints the PHW error line and exits 1.
 */
export function exitWith(run: () => Promise<number>): void {
  void run().then(
    (code) => flushThenExit(code),
    (error: unknown) => {
      emitWizardError({
        code: ErrorCodes.InternalUnhandled,
        message: error instanceof Error ? error.message : String(error),
      });
      return flushThenExit(1);
    },
  );
}

/**
 * Run a host with a signal SIGINT, SIGTERM and SIGHUP abort (the reason is the
 * signal name), and settle as it does. A closed terminal sends SIGHUP, which
 * the hosts end like Ctrl-C. The listeners go once it settles, so what runs
 * after it, such as a fallback with no screens, ends on Ctrl-C as Node does.
 */
export async function underSignals(
  run: (signal: AbortSignal) => Promise<number>,
): Promise<number> {
  const controller = new AbortController();
  const onSignal = (name: NodeJS.Signals) => {
    if (name === 'SIGHUP') hungUp = true;
    controller.abort(name);
  };
  // Attached up front: a first touch of a stream after a hangup reopens the dead terminal and blocks.
  for (const stream of OUTPUT_STREAMS) stream.on('error', onOutputError);
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  process.on('SIGHUP', onSignal);
  try {
    return await run(controller.signal);
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    process.off('SIGHUP', onSignal);
    // After a hangup the exit drain still writes to the dead terminal, so the guard stays.
    if (!hungUp) {
      for (const stream of OUTPUT_STREAMS) stream.off('error', onOutputError);
    }
  }
}

const OUTPUT_STREAMS = [process.stdout, process.stderr];
let hungUp = false;

/** A write to a closed terminal fails; that ends nothing, so the run still reports its end. */
function onOutputError(error: NodeJS.ErrnoException): void {
  // EIO can land before the SIGHUP does, and only a gone terminal raises it.
  if (error.code === 'EIO') return;
  if (hungUp && HANGUP_WRITE_ERRORS.has(error.code ?? '')) return;
  throw error;
}

const HANGUP_WRITE_ERRORS = new Set(['EPIPE', 'ERR_STREAM_DESTROYED']);

/** Run a host under the signals, then exit with the code it resolves. */
export function withSignals(
  run: (signal: AbortSignal) => Promise<number>,
): void {
  exitWith(() => underSignals(run));
}
