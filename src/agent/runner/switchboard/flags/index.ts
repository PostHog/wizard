/**
 * Switchboard flags, one module per experiment. Every experiment declares its
 * own scope — which program(s) its flags route — so the flag→program mapping
 * is readable per file, never implied. `schemes.ts` owns the shared config
 * shapes and resolution.
 */
import { RUN_SURFACE } from '@env';
import { logToFile } from '@utils/debug';
import { ORCHESTRATOR_STAGE_OVERRIDES } from './orchestrator';
import { SELF_DRIVING_EXPERIMENT } from './self-driving';
import {
  routeFromConfigFlag,
  stageOverridesFromPayload,
  type FlagRoute,
  type HarnessExperiment,
  type StageOverride,
} from './schemes';

/** Every routing experiment. An experiment routes ONLY by being listed here, and only for the program it declares. */
export const HARNESS_EXPERIMENTS: readonly HarnessExperiment[] = [
  SELF_DRIVING_EXPERIMENT,
];

/** The flag-driven route for a program, or undefined when no experiment covers it or its flags don't validly route. */
export function resolveFlagRoute(
  program: string,
  flags: Record<string, string>,
  flagPayloads?: Record<string, unknown>,
): FlagRoute | undefined {
  const experiment = HARNESS_EXPERIMENTS.find((e) => e.program === program);
  return (
    experiment && routeFromConfigFlag(experiment.flags, flags, flagPayloads)
  );
}

/** The per-stage overrides for a program's run, or undefined (prompt frontmatter stays). Applied once, where the agent prompts are loaded. */
export function resolveStageOverrides(
  program: string,
  flags: Record<string, string>,
  flagPayloads?: Record<string, unknown>,
): Record<string, StageOverride> | undefined {
  if (RUN_SURFACE === 'cloud') return undefined;
  const exp = ORCHESTRATOR_STAGE_OVERRIDES;
  if (!exp.programs.includes(program)) return undefined;
  const variant = flags[exp.flag];
  if (!variant || variant === 'false') return undefined;
  const overrides = stageOverridesFromPayload(flagPayloads?.[exp.flag]);
  if (!overrides) {
    logToFile(
      `[switchboard] ${exp.flag}=${variant} but payload missing/invalid — keeping frontmatter`,
    );
  }
  return overrides;
}

export { areSeededTasksEnabled } from './orchestrator';
export { isAgentDagEnabled } from './agent-dag';
export type {
  ConfigFlag,
  FlagRoute,
  HarnessExperiment,
  StageOverride,
} from './schemes';
