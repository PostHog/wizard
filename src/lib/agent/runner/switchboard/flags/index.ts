/**
 * Switchboard flags, one module per experiment. Every experiment declares its
 * own scope — which program(s) its flags route — so the flag→program mapping
 * is readable per file, never implied. `schemes.ts` owns the shared config
 * shapes and resolution.
 */
import { RUN_SURFACE } from '@env';
import type { Sequence } from '@lib/constants';
import type { ProgramId } from '@lib/programs/program-registry';
import { BASIC_INTEGRATION_EXPERIMENT } from './basic-integration';
import { ORCHESTRATOR_EXPERIMENT } from './orchestrator';
import { REVIEW_MODEL_EXPERIMENT } from './review-model';
import { SELF_DRIVING_EXPERIMENT } from './self-driving';
import {
  routeFromConfigFlag,
  routeFromRoleFlag,
  type FlagRoute,
  type HarnessExperiment,
  type RoleExperiment,
  type SequenceExperiment,
} from './schemes';

/** Every experiment on each axis. An experiment routes ONLY by being listed here, and only for the programs it declares. */
export const HARNESS_EXPERIMENTS: readonly HarnessExperiment[] = [
  BASIC_INTEGRATION_EXPERIMENT,
  SELF_DRIVING_EXPERIMENT,
];
export const SEQUENCE_EXPERIMENTS: readonly SequenceExperiment[] = [
  ORCHESTRATOR_EXPERIMENT,
];
export const ROLE_EXPERIMENTS: readonly RoleExperiment[] = [
  REVIEW_MODEL_EXPERIMENT,
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

/** The role-scoped route for one task role, or undefined (prompt frontmatter stays). */
export function resolveRoleRoute(
  program: ProgramId,
  role: string,
  flags: Record<string, string>,
): ReturnType<typeof routeFromRoleFlag> {
  if (RUN_SURFACE === 'cloud') return undefined;
  const experiment = ROLE_EXPERIMENTS.find(
    (e) => e.program === program && e.role === role,
  );
  return experiment && routeFromRoleFlag(experiment, flags);
}

export { isOrchestratorEnabled } from './orchestrator';
export type {
  ConfigFlag,
  FlagRoute,
  HarnessExperiment,
  RoleExperiment,
  SequenceExperiment,
} from './schemes';
