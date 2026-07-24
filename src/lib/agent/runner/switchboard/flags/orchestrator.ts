/** Orchestrator gate: wizard-orchestrator on/off. On routes the declared programs to the orchestrator on pi; every model/effort comes from prompt frontmatter. */
import {
  Harness,
  Sequence,
  WIZARD_ORCHESTRATOR_FLAG_KEY,
} from '@lib/constants';
import type { HarnessExperiment, SequenceExperiment } from './schemes';

export const ORCHESTRATOR_EXPERIMENT: SequenceExperiment = {
  programs: ['posthog-integration'],
  flag: WIZARD_ORCHESTRATOR_FLAG_KEY,
  sequence: Sequence.orchestrator,
};

/** Same flag, harness axis: the orchestrator drives tasks through pi. */
export const ORCHESTRATOR_PI_ROUTE: HarnessExperiment = {
  program: 'posthog-integration',
  flags: { useFlag: WIZARD_ORCHESTRATOR_FLAG_KEY, harness: Harness.pi },
};

/** Raw flag read — for telemetry/log lines only, never for routing. */
export function isOrchestratorEnabled(
  flags: Record<string, string> = {},
): boolean {
  return flags[ORCHESTRATOR_EXPERIMENT.flag] === 'true';
}
