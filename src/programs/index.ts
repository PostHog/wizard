/** Public runtime entry for the programs surface. */
export type * from './types';
export { PROGRAM_BINDINGS, resolveProgramBinding } from './binding';
export { getProgramCommandments } from './commandments';
export { captureSwitchboardDecision } from './binding-telemetry';
export { areSeededTasksEnabled, resolveStageOverrides } from './experiments';
export {
  Program,
  PROGRAM_REGISTRY,
  getProgramConfig,
  getSubcommandPrograms,
  getCommandPath,
  getLaunchablePrograms,
} from './program-registry';
