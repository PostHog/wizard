import type { AgentProgress, SpinnerHandle } from '@agent/types';

/** Effects the non-interactive runner supplies while a program scopes its project. */
export type CiRunnerContext = {
  log: {
    info(message: string): void;
    warn(message: string): void;
  };
  /** Log in for `programId` if not already (idempotent); the runner owns login. */
  authenticate(programId: string): Promise<void>;
  /** Agent progress from a scan the program runs, for the runner's output. */
  onProgress?(event: AgentProgress): void;
};

/** Live UI effects a program may need after its run definition resolves. */
export type RunnerContext = {
  getFrameworkContext(key: string): unknown;
  setFrameworkContext(key: string, value: unknown): void;
  log: {
    info(message: string): void;
    warn(message: string): void;
  };
  spinner(): SpinnerHandle;
};
