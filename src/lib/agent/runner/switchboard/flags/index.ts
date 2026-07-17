/**
 * Switchboard flags, one module per experiment. Every experiment declares its
 * own scope — which program(s) its flags route — so the flag→program mapping
 * is readable per file, never implied. `schemes.ts` owns the shared config
 * shapes and resolution.
 */
import { RUN_SURFACE } from '@env';
import type { ProgramId } from '@lib/programs/program-registry';
import { BASIC_INTEGRATION_EXPERIMENT } from './basic-integration';
import { SELF_DRIVING_EXPERIMENT } from './self-driving';
import {
  routeFromConfigFlag,
  type FlagRoute,
  type HarnessExperiment,
} from './schemes';

const HARNESS_EXPERIMENTS: readonly HarnessExperiment[] = [
  BASIC_INTEGRATION_EXPERIMENT,
  SELF_DRIVING_EXPERIMENT,
];

/** The flag-driven route for a program, or undefined when no experiment covers it or its flags don't validly route. */
export function resolveFlagRoute(
  program: ProgramId,
  flags: Record<string, string>,
  flagPayloads?: Record<string, unknown>,
): FlagRoute | undefined {
  // Flag experiments are disabled on the cloud (headless) run surface.
  if (RUN_SURFACE === 'cloud') return undefined;
  const experiment = HARNESS_EXPERIMENTS.find((e) => e.program === program);
  return (
    experiment && routeFromConfigFlag(experiment.flags, flags, flagPayloads)
  );
}

export { isOrchestratorEnabled, orchestratorFlagRoutes } from './orchestrator';
export type {
  ConfigFlag,
  FlagRoute,
  HarnessExperiment,
  SequenceExperiment,
} from './schemes';
