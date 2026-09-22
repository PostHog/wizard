/** Public runtime entry for the programs surface. */
export type * from './types';
export { PROGRAM_BINDINGS, resolveProgramBinding } from './binding';
export { getProgramCommandments } from './commandments';
export { captureSwitchboardDecision } from './binding-telemetry';
export { areSeededTasksEnabled, resolveStageOverrides } from './experiments';
/** Keep agent and execution imports out of CLI startup until a program runs. */
export async function runProgram(
  programId: string,
  input: import('./run-program').ProgramInput,
  options?: import('./run-program').ProgramOptions,
): Promise<import('./run-program').ProgramRunOutcome> {
  const entry = await import('./run-program');
  return entry.runProgram(programId, input, options);
}
export {
  Program,
  PROGRAM_REGISTRY,
  getProgramConfig,
  getSubcommandPrograms,
  getCommandPath,
  getLaunchablePrograms,
} from './program-registry';
