/** Public runtime entry for the programs surface. */
export type * from './types';
export { runProgram } from './run-program';
export {
  Program,
  PROGRAM_REGISTRY,
  getProgramConfig,
  getSubcommandPrograms,
  getCommandPath,
  getLaunchablePrograms,
} from './program-registry';
