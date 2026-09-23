import type { AgentProgress, OutroData, SpinnerHandle } from '@agent/types';
import type { ErrorCode } from '@shared/errors';
import type { AuthHost } from '@programs/authenticate';

/** Effects the non-interactive host supplies while a program scopes its project. */
export type ProgramCiHost = {
  auth: AuthHost;
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
  info(message: string): void;
  warn(message: string): void;
  spinner(): SpinnerHandle;
};

/** A failure the host ends the run with, as its abort path renders and exits. */
export type HostFailure = {
  message?: string;
  outroData?: OutroData;
  error?: Error;
  exitCode?: number;
  code?: ErrorCode;
  detail?: Record<string, unknown>;
};
