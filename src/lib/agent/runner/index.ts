/**
 * Unified program runner — dispatcher.
 *
 * Single configurable pipeline for all programs. Each program
 * provides a ProgramRun (via the `run` field on ProgramConfig)
 * that controls:
 *   - Whether a skill is pre-installed or discovered at runtime
 *   - How the agent prompt is built
 *   - What MCP servers and package manager detector to use
 *   - What happens after the agent completes
 *
 * The pipeline runs a shared bootstrap (logging, health check, settings, OAuth,
 * flags, MCP url), then forks. The `orchestrator` variant routes to the
 * experimental task-queue runner. Every other variant runs the fixed linear
 * pipeline:
 *   [skill install] → agent init → prompt → run → errors → [postRun] → outro
 */

import type { WizardSession } from '../../wizard-session';
import { analytics } from '@utils/analytics';
import { isOrchestratorEnabled } from '../agent-interface';
import { getUI } from '../../../ui';
import { runOrchestrator } from './orchestrator/orchestrator-runner';
import type { ProgramConfig } from '../../programs/program-step';
import { WizardVariant } from './shared/types';
import type { ProgramRun, BootstrapResult } from './shared/types';
import { bootstrapProgram } from './shared/bootstrap';
import { runLinearProgram } from './linear';
import { flushScanReport } from '../../yara-hooks';
import { registerCleanup } from '../../../utils/wizard-abort';

export type {
  ProgramRun,
  BootstrapResult,
  AbortCase,
  PromptContext,
  Credentials,
} from './shared/types';
export { shouldDisableAsk } from './shared/bootstrap';

/**
 * Resolve a ProgramConfig's agent run definition and execute the pipeline.
 * Entry point for bin.ts — handles buildRunConfig, bootstrap, and (future) run field.
 */
export async function runAgent(
  programConfig: ProgramConfig,
  session: WizardSession,
  options: { composed?: boolean } = {},
): Promise<void> {
  if (!programConfig.run) {
    throw new Error(`Program "${programConfig.id}" has no run configuration.`);
  }

  const runDef =
    typeof programConfig.run === 'function'
      ? await programConfig.run(session)
      : programConfig.run;

  await runProgram(session, runDef, programConfig, options);
}

/**
 * Run a program's agent pipeline.
 *
 * Runs the shared bootstrap, then forks on the `wizard-orchestrator` flag.
 * When enabled the run routes to the experimental task-queue runner; otherwise
 * it runs the linear pipeline.
 */
export async function runProgram(
  session: WizardSession,
  config: ProgramRun,
  programConfig: ProgramConfig,
  options: { composed?: boolean } = {},
): Promise<void> {
  const boot = await bootstrapProgram(session, config, programConfig);

  // Flush the warlock scan report once, at this single seam, on every
  // termination path and for every harness (linear, orchestrator, or future):
  //   - registerCleanup covers the abort/cancel path (wizardAbort runs the
  //     registered cleanups; the success path never calls them)
  //   - the finally covers normal completion and any direct throw that unwinds
  //     through here
  // flushScanReport is idempotent (it zeroes scan state), so the overlap is a
  // harmless no-op. No harness has to know reporting exists.
  registerCleanup(() => flushScanReport(session));
  try {
    if (isOrchestratorEnabled(boot.wizardFlags)) {
      getUI().log.info('Task-queue orchestrator enabled.');
      stampVariant(boot, WizardVariant.ORCHESTRATOR);
      // composed-run guard is linear-only; the orchestrator is experimental.
      return await runOrchestrator(session, programConfig, boot);
    }

    stampVariant(boot, WizardVariant.BASE);
    return await runLinearProgram(
      session,
      config,
      programConfig,
      boot,
      options.composed ?? false,
    );
  } finally {
    flushScanReport(session);
  }
}

/**
 * Record which runner arm ran. Tags every wizard event and every gateway trace
 * with the variant, so runs segment by arm (base vs orchestrator, later pi).
 */
function stampVariant(boot: BootstrapResult, variant: WizardVariant): void {
  analytics.setTag('variant', variant);
  boot.wizardMetadata.VARIANT = variant;
}
