/** Public runtime entry for the programs surface. */
export type * from './types';
/** Load gateway minting only when the caller requests model auth. */
export function createPosthogInferenceAuthProvider(
  posthog: import('@shared/api').Credentials,
  programId: string,
): import('@agent/types').InferenceAuthProvider {
  return {
    resolve: async () => {
      const { createPosthogInferenceAuthProvider } = await import(
        './credentials'
      );
      return createPosthogInferenceAuthProvider(posthog, programId).resolve();
    },
  };
}
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
