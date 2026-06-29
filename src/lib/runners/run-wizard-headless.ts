import type { ProgramConfig } from '@lib/programs/program-step';
import { runNonInteractive } from './run-non-interactive';

/**
 * Headless entry point (the experimental published-build, non-interactive run
 * path; see @lib/headless-mode). A thin shell over the shared non-interactive
 * pipeline — see `runNonInteractive`. Today it behaves exactly like
 * `runWizardCI`; it exists as a separate function so headless can diverge later
 * (its own auth handling, telemetry, prompts, …) without touching CI or its
 * callers. Diverge by branching on the mode inside `runNonInteractive`, or by
 * giving this function its own body.
 */
export function runWizardHeadless(
  config: ProgramConfig,
  options: Record<string, unknown>,
): void {
  runNonInteractive(config, options, 'headless');
}
