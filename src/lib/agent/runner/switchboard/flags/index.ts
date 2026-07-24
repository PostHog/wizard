/**
 * Switchboard flags, one module per experiment. Every experiment declares its
 * own scope — which program(s) its flags route — so the flag→program mapping
 * is readable per file, never implied. `schemes.ts` owns the shared config
 * shapes and resolution.
 */
import { RUN_SURFACE } from '@env';
import { logToFile } from '@utils/debug';
import type { Sequence } from '@lib/constants';
import type { ProgramId } from '@lib/programs/program-registry';
import {
  ORCHESTRATOR_HARNESS_ROUTE,
  ORCHESTRATOR_SEQUENCE_ROUTE,
  ORCHESTRATOR_STAGE_OVERRIDES,
} from './orchestrator';
import { SELF_DRIVING_EXPERIMENT } from './self-driving';
import {
  routeFromConfigFlag,
  stageOverridesFromPayload,
  type FlagRoute,
  type HarnessExperiment,
  type SequenceExperiment,
  type StageOverride,
} from './schemes';

/** Every experiment on each axis. An experiment routes ONLY by being listed here, and only for the programs it declares. */
export const HARNESS_EXPERIMENTS: readonly HarnessExperiment[] = [
  ORCHESTRATOR_HARNESS_ROUTE,
  SELF_DRIVING_EXPERIMENT,
];
export const SEQUENCE_EXPERIMENTS: readonly SequenceExperiment[] = [
  ORCHESTRATOR_SEQUENCE_ROUTE,
];

/** The flag-driven route for a program, or undefined when no experiment covers it or its flags don't validly route. */
export function resolveFlagRoute(
  program: ProgramId,
  flags: Record<string, string>,
  flagPayloads?: Record<string, unknown>,
): FlagRoute | undefined {
  // Harness experiments are disabled on the cloud (headless) run surface.
  if (RUN_SURFACE === 'cloud') return undefined;
  const experiment = HARNESS_EXPERIMENTS.find((e) => e.program === program);
  return (
    experiment && routeFromConfigFlag(experiment.flags, flags, flagPayloads)
  );
}

/** The flag-driven sequence for a program, or undefined when no sequence experiment covers it with its flag on. Surface/build scoping is the flag's own job (see `flagPersonProperties`). */
export function resolveFlagSequence(
  program: ProgramId,
  flags: Record<string, string>,
): Sequence | undefined {
  return SEQUENCE_EXPERIMENTS.find(
    (e) => e.programs.includes(program) && flags[e.flag] === 'true',
  )?.sequence;
}

/** The override for one orchestrator stage, or undefined (prompt frontmatter stays). */
export function resolveStageOverride(
  program: ProgramId,
  stage: string,
  flags: Record<string, string>,
  flagPayloads?: Record<string, unknown>,
): StageOverride | undefined {
  if (RUN_SURFACE === 'cloud') return undefined;
  if (!ORCHESTRATOR_STAGE_OVERRIDES.programs.includes(program)) {
    return undefined;
  }
  const exp = ORCHESTRATOR_STAGE_OVERRIDES;
  const variant = flags[exp.flag];
  if (!variant || variant === 'false') return undefined;
  const overrides = stageOverridesFromPayload(flagPayloads?.[exp.flag]);
  if (!overrides) {
    logToFile(
      `[switchboard] ${exp.flag}=${variant} but payload missing/invalid — keeping frontmatter`,
    );
  }
  return overrides?.[stage];
}

export { isOrchestratorEnabled } from './orchestrator';
export type {
  ConfigFlag,
  FlagRoute,
  HarnessExperiment,
  SequenceExperiment,
  StageOverride,
} from './schemes';
