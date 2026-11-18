/** Orchestrator flags: per-stage overrides. The route itself is each program's binding. */
import { WIZARD_ORCHESTRATOR_OVERRIDE_FLAG_KEY } from '@shared/constants';

/** Per-stage overrides: the variant payload (`{stage: {model?, effort?}}`) outranks prompt frontmatter for the stages it names. */
export const ORCHESTRATOR_STAGE_OVERRIDES: {
  programs: readonly string[];
  flag: string;
} = {
  programs: ['posthog-integration'],
  flag: WIZARD_ORCHESTRATOR_OVERRIDE_FLAG_KEY,
};
