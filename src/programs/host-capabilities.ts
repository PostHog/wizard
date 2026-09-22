import type { AgentProgress } from '@agent/types';
import type { AuthProjection } from '@programs/authenticate';
import type { Integration } from '@shared/constants';

/** Effects the non-interactive host supplies while a program scopes its project. */
export type ProgramCiHost = {
  auth: AuthProjection;
  log: {
    info(message: string): void;
    warn(message: string): void;
  };
  onProgress(event: AgentProgress): void;
};

/** Live UI effects a legacy program may need after its run definition resolves. */
export type ProgramRunHost = {
  getFrameworkContext(key: string): unknown;
  setFrameworkContext(key: string, value: unknown): void;
  warn(message: string): void;
  uploadEnvironmentVariables(
    envVars: Record<string, string>,
    integration: Integration,
    installDir: string,
  ): Promise<string[]>;
};
