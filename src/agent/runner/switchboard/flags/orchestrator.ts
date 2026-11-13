/** Orchestrator flags: per-stage overrides and the seeded-task kill switch. The route itself is each program's binding. */
import {
  WIZARD_ORCHESTRATOR_OVERRIDE_FLAG_KEY,
  WIZARD_ORCHESTRATOR_SEEDED_TASKS_FLAG_KEY,
} from '@shared/constants';

/** Per-stage overrides: the variant payload (`{stage: {model?, effort?}}`) outranks prompt frontmatter for the stages it names. */
export const ORCHESTRATOR_STAGE_OVERRIDES: {
  programs: readonly string[];
  flag: string;
} = {
  programs: ['posthog-integration'],
  flag: WIZARD_ORCHESTRATOR_OVERRIDE_FLAG_KEY,
};

/**
 * Kill switch for the runner-seeded task mechanism (the optional warehouse
 * step). Off or unset, the orchestrator queues nothing itself and the run is
 * identical to a project with no detected sources.
 */
export function areSeededTasksEnabled(
  flags: Record<string, string> = {},
): boolean {
  return flags[WIZARD_ORCHESTRATOR_SEEDED_TASKS_FLAG_KEY] === 'true';
}
