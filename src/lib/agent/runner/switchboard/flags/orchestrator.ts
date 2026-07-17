/**
 * Orchestrator experiment.
 *
 * Flag:   wizard-orchestrator (bool)
 * Routes: ONLY the programs listed below — sequence axis. context-mill
 *         publishes orchestrator agent prompts (seed + per-task) per flow, so
 *         a program joins the experiment by shipping prompts AND being added
 *         here. Other programs can still pin `sequence` via their own flag
 *         route's payload.
 */
import { WIZARD_ORCHESTRATOR_FLAG_KEY } from '@lib/constants';
import type { ProgramId } from '@lib/programs/program-registry';
import type { SequenceExperiment } from './schemes';

export const ORCHESTRATOR_EXPERIMENT: SequenceExperiment = {
  programs: ['posthog-integration'],
  flag: WIZARD_ORCHESTRATOR_FLAG_KEY,
};

/** Raw flag read — for telemetry/log lines only, never for routing. */
export function isOrchestratorEnabled(
  flags: Record<string, string> = {},
): boolean {
  return flags[ORCHESTRATOR_EXPERIMENT.flag] === 'true';
}

/** Routing check: the flag is on AND the experiment covers this program. */
export function orchestratorFlagRoutes(
  program: ProgramId,
  flags: Record<string, string> = {},
): boolean {
  return (
    ORCHESTRATOR_EXPERIMENT.programs.includes(program) &&
    isOrchestratorEnabled(flags)
  );
}
