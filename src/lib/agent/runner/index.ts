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
import { Sequence } from '@lib/constants';
import { getUI } from '../../../ui';
import type { ProgramConfig } from '../../programs/program-step';
import type { ProgramRun, BootstrapResult } from './shared/types';
import { bootstrapProgram } from './shared/bootstrap';
import {
  getSequence,
  resolveBinding,
  type ProgramBinding,
} from './switchboard';
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
 * Bootstrap → bind the program via the switchboard (resolve which sequence
 * and harness will run it, tag both axes) → dispatch to the resolved
 * sequence's runner.
 */
export async function runProgram(
  session: WizardSession,
  config: ProgramRun,
  programConfig: ProgramConfig,
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
    const binding = resolveProgramRunner(session, programConfig, boot);
    if (binding.sequence === Sequence.orchestrator) {
      getUI().log.info('Task-queue orchestrator enabled.');
    }
    return await getSequence(binding.sequence).run(
      session,
      config,
      programConfig,
      boot,
    );
  } finally {
    flushScanReport(session);
  }
}

/**
 * Resolve which sequence and harness will run a program (CLI → PostHog flag →
 * per-program binding → default), tag both axes onto analytics, and return the
 * binding for downstream dispatch.
 *
 * The one place `runner/index.ts` reaches into the switchboard — every other
 * concern (bootstrap, cleanup, dispatch, per-task per-role harness picks) is
 * either upstream or downstream of this call.
 */
function resolveProgramRunner(
  session: WizardSession,
  programConfig: ProgramConfig,
  boot: BootstrapResult,
): ProgramBinding {
  const binding = resolveBinding({
    program: programConfig.id,
    flags: boot.wizardFlags,
    cliHarness: session.harness,
    cliSequence: session.sequence,
  });
  tagBinding(boot, binding);
  return binding;
}

/**
 * Tag the run with its two routing axes. Sequence is stable for the whole
 * run; harness reflects the run-level (default-role) resolution — orchestrator
 * per-task calls emit their own `harness` property in their events so per-task
 * aggregations attribute correctly.
 */
function tagBinding(boot: BootstrapResult, binding: ProgramBinding): void {
  analytics.setTag('sequence', binding.sequence);
  analytics.setTag('harness', binding.harness);
  boot.wizardMetadata.SEQUENCE = binding.sequence;
  boot.wizardMetadata.HARNESS = binding.harness;
}
