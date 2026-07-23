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
import { SELF_DRIVING_EXPERIMENT } from './self-driving';
import {
  routeFromConfigFlag,
  type FlagRoute,
  type HarnessExperiment,
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

/** The flag-driven sequence for a program, or undefined when no sequence experiment covers it with its flag on. */
export function resolveFlagSequence(
  program: ProgramId,
  flags: Record<string, string>,
): Sequence | undefined {
  // Sequence experiments are disabled on the cloud (headless) run surface,
  // like harness experiments above: pi is local-only there, so the flag would
  // pair the orchestrator with the anthropic fallback instead of its arm.
  if (RUN_SURFACE === 'cloud') return undefined;
  return SEQUENCE_EXPERIMENTS.find(
    (e) => e.programs.includes(program) && flags[e.flag] === 'true',
  )?.sequence;
}

export { isOrchestratorEnabled } from './orchestrator';
export type {
  ConfigFlag,
  FlagRoute,
  HarnessExperiment,
  SequenceExperiment,
} from './schemes';
