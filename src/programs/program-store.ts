/* eslint-disable @typescript-eslint/no-unused-vars -- A shell: B3 fills in the bodies. */
import type { AgentProgress, ResolvedBinding, RunResult } from '@agent/types';
import type { ApiProject, ApiUser, Credentials } from '@shared/api';

/** One agent run's progress event, attributed to its run. */
export type ProgramRunProgress = {
  kind: 'run'; // one agent event
  runId: string; // the run it came from
  event: AgentProgress; // status, tasks, links, completion and more
};

/** A copy of the invocation's data, sent after each write. */
export type ProgramDataProgress = {
  kind: 'program'; // the program's data changed
  data: ProgramInvocationData; // a copy of it after the change
};

export type ProgramProgress = ProgramRunProgress | ProgramDataProgress;

/** What a diagnostic is about: one run's progress event, or a data snapshot. */
type DiagnosticSource =
  | { runId: string; eventKind: AgentProgress['kind'] }
  | { eventKind: 'data' };

/** An observer failure or a late event, kept instead of breaking the run. */
export type ProgramDiagnostic = DiagnosticSource & { message: string };

/** Data owned by one program invocation, independent of its progress feed. */
export type ProgramInvocationData = {
  credentials: Credentials | null; // the login; holds tokens, don't log it
  apiProject: ApiProject | null; // the login's project
  apiUser: ApiUser | null; // the login's user
  detection: { frameworkContext: Record<string, unknown> }; // always {} here
  binding: ResolvedBinding | null; // the route; null until it resolves
  aiSdkStampReported: boolean; // true once the AI SDK stamp was considered
};

/** An agent run's final result. */
export type SettledProgramRun = {
  runId: string; // the run's label
  result: RunResult; // what runAgent returned
};

export type AgentProgressAdapter = {
  onProgress(event: AgentProgress): void;
  finish(result: RunResult): void;
};

export class ProgramStore {
  constructor(
    options: {
      aiSdkStampReported?: boolean;
      onData?: (progress: ProgramDataProgress) => void;
    } = {},
  ) {
    throw new Error('ProgramStore: not implemented');
  }

  readData(): ProgramInvocationData {
    throw new Error('ProgramStore: not implemented');
  }

  setAuthenticated(
    auth: Pick<ProgramInvocationData, 'credentials' | 'apiProject' | 'apiUser'>,
  ): void {
    throw new Error('ProgramStore: not implemented');
  }

  setFrameworkContext(key: string, value: unknown): void {
    throw new Error('ProgramStore: not implemented');
  }

  setBinding(binding: ResolvedBinding): void {
    throw new Error('ProgramStore: not implemented');
  }

  setAiSdkStampReported(): void {
    throw new Error('ProgramStore: not implemented');
  }

  beginRun(
    runId: string,
    observer?: (progress: ProgramRunProgress) => void,
  ): AgentProgressAdapter {
    throw new Error('ProgramStore: not implemented');
  }

  settledRuns(): SettledProgramRun[] {
    throw new Error('ProgramStore: not implemented');
  }

  readDiagnostics(): ProgramDiagnostic[] {
    throw new Error('ProgramStore: not implemented');
  }
}
