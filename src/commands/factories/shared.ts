import type { Arguments, Options } from 'yargs';

import { runWizard, runWizardCI } from '@lib/runners';
import type { ProgramConfig } from '@lib/programs/program-step';

import { skillProgramOptions } from '../skill-program-options';

/**
 * Dispatch a parsed yargs invocation to the wizard runner. Applies the
 * program's `mapCliOptions` transform, then routes to `runWizard` or
 * `runWizardCI` based on the `--ci` flag.
 *
 * Every command file used to inline this; the factories call it instead.
 */
/**
 * Run a command's async body as fire-and-forget while still surfacing failures.
 * yargs handlers are synchronous, so async work kicks off a detached promise —
 * without this, a rejection becomes an unhandled promise rejection (no message,
 * wrong exit code). This awaits the work and turns any error into a clean
 * message + non-zero exit.
 */
export function runCommandHandler(work: () => void | Promise<void>): void {
  void (async () => {
    try {
      await work();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`\n\x1b[1;91m✖ ${msg}\x1b[0m\n\n`);
      process.exit(1);
    }
  })();
}

export function dispatchProgram(config: ProgramConfig, argv: Arguments): void {
  const argvRecord = argv as unknown as Record<string, unknown>;
  const extras = config.mapCliOptions?.(argvRecord) ?? {};
  const options = { ...argvRecord, ...extras };
  if (options.ci) {
    runWizardCI(config, options);
  } else {
    runWizard(config, options);
  }
}

/**
 * Merge the standard skill-program flags (`--debug`, `--install-dir`, etc.)
 * with any program-specific options declared on `cliOptions`.
 *
 * Program-specific options shadow the standard ones — that's intentional, so
 * a program can override a default flag if it ever needs to.
 */
export function mergeCommandOptions(
  config: ProgramConfig,
): Record<string, Options> {
  return {
    ...skillProgramOptions,
    ...((config.cliOptions ?? {}) as Record<string, Options>),
  };
}
