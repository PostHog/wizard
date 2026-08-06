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

import type { Options } from 'yargs';

/**
 * The on-CLI flag name. Intentionally ugly + undocumented; do not surface it in
 * `--help`, the README, or user-facing error messages.
 */
export const HEADLESS_FLAG = 'headless-DONOTUSE-EXPERIMENTAL';

/**
 * The yargs option declaration for the headless flag. Declared per-command
 * (basic integration + audit) rather than globally, so no other command
 * accepts it. Spread into a command's `options` to opt it into headless.
 */
export const headlessOption: Record<string, Options> = {
  [HEADLESS_FLAG]: {
    default: false,
    // EXPERIMENTAL + UNSTABLE: the non-interactive published-build run path.
    // Declared unconditionally (unlike --ci) so it works in the shipped
    // package, but hidden and intentionally ugly-named — the contract may
    // break without notice, so it must not be advertised.
    describe:
      'EXPERIMENTAL — do not use. Unstable, subject to breaking changes.',
    type: 'boolean',
    hidden: true,
  },
};

/**
 * Read the headless signal off a parsed argv / options bag. yargs always sets
 * the value under the declared key (`HEADLESS_FLAG`), so reading that key is
 * reliable regardless of camel-case expansion.
 */
export function isHeadless(options: Record<string, unknown>): boolean {
  return options[HEADLESS_FLAG] === true;
}

// `--region` only means something non-interactively (API-key auth has no OAuth
// token response to read `posthog_region` from), so only headless-capable
// commands declare it.
export const regionOption: Record<string, Options> = {
  region: {
    describe: 'PostHog cloud region\nenv: POSTHOG_WIZARD_REGION',
    choices: ['us', 'eu'],
    type: 'string',
    hidden: true,
  },
};
