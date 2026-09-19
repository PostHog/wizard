import type { ProgramConfig } from '@store/types';
import { runNonInteractive } from './run-non-interactive.js';

/**
 * CI-mode entry point (`--ci`, dev/test builds). A thin shell over the shared
 * non-interactive pipeline — see `runNonInteractive`. Kept as its own function
 * so CI and headless (`runWizardHeadless`) can diverge without re-threading the
 * many callers that route here.
 */
export function runWizardCI(
  config: ProgramConfig,
  options: Record<string, unknown>,
): void {
  runNonInteractive(config, options, 'ci');
}
