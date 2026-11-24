import type { Arguments } from 'yargs';
import { consoleLog } from '@shared/console-log';
import { runWizardCI, runWizardHeadless } from '@cli/runners';
import type { NonInteractiveMode } from '@headless';
import { config as posthogIntegrationConfig } from '@programs/posthog-integration';

/**
 * CI-mode install entry point (`--ci`, dev/test builds). Thin shell over the
 * shared non-interactive install — see `runNonInteractiveInstall`.
 */
export function runCIInstall(argv: Arguments): void {
  runNonInteractiveInstall(argv, 'ci');
}

/**
 * Headless install entry point (the experimental published-build run path; see
 * @shared/headless-mode). Thin shell over the shared non-interactive install.
 * Today it behaves exactly like `runCIInstall`; it is a separate function so
 * headless can diverge later (auth, prompts, …) without touching the CI path.
 */
export function runHeadlessInstall(argv: Arguments): void {
  runNonInteractiveInstall(argv, 'headless');
}

/**
 * Non-interactive install shared by CI and headless. The runner validates the
 * options (`--signup`, `--api-key`, `--install-dir`); `mode` only changes
 * user-facing labels and which runner is invoked.
 */
function runNonInteractiveInstall(
  argv: Arguments,
  mode: NonInteractiveMode,
): void {
  const runWizard = mode === 'headless' ? runWizardHeadless : runWizardCI;
  warnOnUnexpectedKeyPrefix(argv.apiKey as string | undefined);
  runWizard(posthogIntegrationConfig, argv);
}

/**
 * Decide whether to warn about an unexpected `--api-key` prefix, and with what
 * message. Returns `null` when the key is acceptable.
 *
 * CI and headless accept the same two credentials: a personal API key (`phx_`)
 * and a `pha_` OAuth access token minted under the wizard's own OAuth
 * application (cloud runs, and the CI bot). Both authenticate the mint the
 * same way. Anything else is unexpected and warns.
 *
 * Extracted as a pure predicate so it can be unit-tested without a UI.
 */
export function keyPrefixWarning(apiKey: string | undefined): string | null {
  if (!apiKey || apiKey.startsWith('phx_') || apiKey.startsWith('pha_')) {
    return null;
  }
  const hint = apiKey.startsWith('phc_')
    ? ' (phc_ is a project/client key; expected a personal API key or a wizard-app token)'
    : '';
  return `--api-key does not start with "phx_" or "pha_"${hint}. Continuing anyway, but the LLM Gateway may reject it with a 401.`;
}

function warnOnUnexpectedKeyPrefix(apiKey: string | undefined): void {
  const message = keyPrefixWarning(apiKey);
  if (!message) return;
  consoleLog.intro('PostHog Wizard');
  consoleLog.log.warn(message);
}
