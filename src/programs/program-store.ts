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

type RunEntry = {
  runId: string;
  result?: RunResult;
};

const MAX_DIAGNOSTICS = 10;

export class ProgramStore {
  private readonly runs: RunEntry[] = [];
  private readonly diagnostics: ProgramDiagnostic[] = [];
  private readonly data: ProgramInvocationData;
  private readonly onData?: (progress: ProgramDataProgress) => void;

  constructor(
    options: {
      aiSdkStampReported?: boolean;
      onData?: (progress: ProgramDataProgress) => void;
    } = {},
  ) {
    this.onData = options.onData;
    this.data = {
      credentials: null,
      apiProject: null,
      apiUser: null,
      detection: { frameworkContext: {} },
      binding: null,
      aiSdkStampReported: options.aiSdkStampReported ?? false,
    };
  }

  readData(): ProgramInvocationData {
    return structuredClone(this.data);
  }

  setAuthenticated(
    auth: Pick<ProgramInvocationData, 'credentials' | 'apiProject' | 'apiUser'>,
  ): void {
    Object.assign(this.data, structuredClone(auth));
    this.emitData();
  }

  setFrameworkContext(key: string, value: unknown): void {
    this.data.detection.frameworkContext[key] = structuredClone(value);
    this.emitData();
  }

  setBinding(binding: ResolvedBinding): void {
    this.data.binding = structuredClone(binding);
    this.emitData();
  }

  setAiSdkStampReported(): void {
    if (this.data.aiSdkStampReported) return;
    this.data.aiSdkStampReported = true;
    this.emitData();
  }

  beginRun(
    runId: string,
    observer?: (progress: ProgramRunProgress) => void,
  ): AgentProgressAdapter {
    const run: RunEntry = { runId };
    this.runs.push(run);

    return {
      onProgress: (event) => {
        const source = { runId: run.runId, eventKind: event.kind };
        if (run.result) {
          this.recordDiagnostic(source, 'progress after finish');
          return;
        }
        if (!observer) return;
        this.deliver(source, () =>
          observer({ kind: 'run', runId, event: structuredClone(event) }),
        );
      },
      finish: (result) => {
        run.result = result;
      },
    };
  }

  settledRuns(): SettledProgramRun[] {
    return this.runs.flatMap(({ runId, result }) =>
      result ? [{ runId, result }] : [],
    );
  }

  readDiagnostics(): ProgramDiagnostic[] {
    return this.diagnostics.map((diagnostic) => ({ ...diagnostic }));
  }

  private emitData(): void {
    const onData = this.onData;
    if (!onData) return;
    this.deliver({ eventKind: 'data' }, () =>
      onData({ kind: 'program', data: this.readData() }),
    );
  }

  /** Never waits for an observer; a throw or a rejection becomes a diagnostic. */
  private deliver(source: DiagnosticSource, send: () => unknown): void {
    try {
      const delivery = send();
      if (
        delivery &&
        typeof (delivery as PromiseLike<unknown>).then === 'function'
      ) {
        void Promise.resolve(delivery).catch((error: unknown) => {
          this.recordDiagnostic(source, error);
        });
      }
    } catch (error) {
      this.recordDiagnostic(source, error);
    }
  }

  private recordDiagnostic(source: DiagnosticSource, error: unknown): void {
    this.diagnostics.push({
      ...source,
      message: error instanceof Error ? error.message : String(error),
    });
    if (this.diagnostics.length > MAX_DIAGNOSTICS) this.diagnostics.shift();
  }
}
