/**
 * Headless mode — the published-build, non-interactive run path.
 *
 * The headless flag and `--ci` both drive a non-interactive install
 * (session.ci === true), but through dedicated entry points so they can
 * diverge: runHeadlessInstall → runWizardHeadless for headless,
 * runCIInstall → runWizardCI for `--ci`. Both delegate to one shared pipeline
 * (runNonInteractive) today; the only forks are the api-key prefixes accepted
 * (ci-install) and the analytics build tag (the mode passed to the runner).
 *
 * The flag is deliberately named `--headless-DONOTUSE-EXPERIMENTAL` and hidden
 * from `--help`: the contract is still unstable and subject to breaking
 * changes, so it must not be advertised or relied on by external callers. This
 * module is the single source of truth for the flag's name and detection — keep
 * the scary name out of every other file so a future rename is one edit here.
 */

/**
 * The on-CLI flag name. Intentionally ugly + undocumented; do not surface it in
 * `--help`, the README, or user-facing error messages.
 */
export const HEADLESS_FLAG = 'headless-DONOTUSE-EXPERIMENTAL';

/**
 * Read the headless signal off a parsed argv / options bag. yargs always sets
 * the value under the declared key (`HEADLESS_FLAG`), so reading that key is
 * reliable regardless of camel-case expansion.
 */
export function isHeadless(options: Record<string, unknown>): boolean {
  return options[HEADLESS_FLAG] === true;
}

/** Detect the headless flag straight off argv, before yargs parses — the analytics singleton initializes at import, ahead of the parse. */
export function isHeadlessArgv(
  argv: readonly string[] = process.argv,
): boolean {
  const flag = `--${HEADLESS_FLAG}`;
  return argv.some((a) => a === flag || a.startsWith(`${flag}=`));
}
