import { CallType } from '@shared/constants';

/**
 * Global identifiers attached to every LLM gateway trace for a run. They ride on
 * each `$ai_generation` the gateway emits (in the `X-PostHog-Properties` blob
 * `buildAgentEnv` builds), so traces are filterable by program, framework, run,
 * and build type for cost attribution and dashboards. `skill_id` is omitted when
 * the run has none.
 */
export function buildRunTags(args: {
  programId: string;
  integration: string;
  runId: string;
  build: string;
  skillId?: string;
}): Record<string, string> {
  return {
    program_id: args.programId,
    integration: args.integration,
    run_id: args.runId,
    build: args.build,
    // Triage and detection spread these tags and override this one.
    call_type: CallType.agent,
    ...(args.skillId ? { skill_id: args.skillId } : {}),
  };
}
