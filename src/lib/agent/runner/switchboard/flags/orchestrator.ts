/**
 * Orchestrator experiment: one boolean flag routing the sequence axis.
 * Percentage rollouts are PostHog-side — this just reads the resolved bool.
 */
import { WIZARD_ORCHESTRATOR_FLAG_KEY } from '@lib/constants';

/** The `wizard-orchestrator` flag is on. */
export function isOrchestratorEnabled(
  flags: Record<string, string> = {},
): boolean {
  return flags[WIZARD_ORCHESTRATOR_FLAG_KEY] === 'true';
}
