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
import { isOrchestratorEnabled } from '../agent-interface';
import { getUI } from '../../../ui';
import { runOrchestrator } from './orchestrator/orchestrator-runner';
import type { ProgramConfig } from '../../programs/program-step';
import type { ProgramRun } from './shared/types';
import { bootstrapProgram } from './shared/bootstrap';
import { runLinearProgram } from './linear';

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
): Promise<void> {
  if (!programConfig.run) {
    throw new Error(`Program "${programConfig.id}" has no run configuration.`);
  }

  const runDef =
    typeof programConfig.run === 'function'
      ? await programConfig.run(session)
      : programConfig.run;

  await runProgram(session, runDef, programConfig);
}

/**
 * Run a program's agent pipeline.
 *
 * Runs the shared bootstrap, then forks on the `wizard-variant` flag. The
 * `orchestrator` variant routes to the experimental task-queue runner; every
 * other variant runs the linear pipeline.
 */
export async function runProgram(
  session: WizardSession,
  config: ProgramRun,
  programConfig: ProgramConfig,
): Promise<void> {
  const boot = await bootstrapProgram(session, config, programConfig);

  if (isOrchestratorEnabled(boot.wizardFlags)) {
    getUI().log.info('Task-queue orchestrator enabled.');
    return runOrchestrator(session, programConfig, boot);
  }

  return runLinearProgram(session, config, programConfig, boot);
}
