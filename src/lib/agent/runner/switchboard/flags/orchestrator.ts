/**
 * Orchestrator experiment — wizard-orchestrator (bool) is the single gate.
 *
 * Routes: ONLY the programs listed below, on BOTH axes — the sequence goes to
 *         orchestrator, and the harness goes to pi pinned to sol-medium (the
 *         pin is the fallback; per-task models come from prompt frontmatter).
 *         context-mill publishes orchestrator agent prompts (seed + per-task)
 *         per flow, so a program joins by shipping prompts AND being added here.
 */
import {
  GPT5_6_SOL_MODEL,
  Sequence,
  WIZARD_ORCHESTRATOR_FLAG_KEY,
} from '@lib/constants';
import type { HarnessExperiment, SequenceExperiment } from './schemes';

export const ORCHESTRATOR_EXPERIMENT: SequenceExperiment = {
  programs: ['posthog-integration'],
  flag: WIZARD_ORCHESTRATOR_FLAG_KEY,
  sequence: Sequence.orchestrator,
};

export const ORCHESTRATOR_PI_ROUTE: HarnessExperiment = {
  program: 'posthog-integration',
  flags: {
    useFlag: WIZARD_ORCHESTRATOR_FLAG_KEY,
    model: GPT5_6_SOL_MODEL,
    effort: 'medium',
  },
};

/** Raw flag read — for telemetry/log lines only, never for routing. */
export function isOrchestratorEnabled(
  flags: Record<string, string> = {},
): boolean {
  return flags[ORCHESTRATOR_EXPERIMENT.flag] === 'true';
}
