import type { Arguments } from 'yargs';
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
 * options (`--signup`, `--api-key`, `--install-dir`) and warns on an unexpected
 * key prefix; `mode` only changes user-facing labels and which runner is invoked.
 */
function runNonInteractiveInstall(
  argv: Arguments,
  mode: NonInteractiveMode,
): void {
  const runWizard = mode === 'headless' ? runWizardHeadless : runWizardCI;
  runWizard(posthogIntegrationConfig, argv);
}
