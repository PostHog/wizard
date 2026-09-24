import type {
  AgentProgress,
  ResolvedBinding,
  RunResult,
} from '../agent/types.js';
import type { ApiProject, ApiUser, Credentials } from '../shared/api.js';
import type { PlannedEvent } from './posthog-integration/watch-event-plan.js';

/** One agent run's progress event, attributed to its run and step. */
export type ProgramRunProgress = {
  kind: 'run';
  runId: string;
  stepId?: string;
  event: AgentProgress;
};

/** A copy of the invocation's data, sent after each write. */
export type ProgramDataProgress = {
  kind: 'program';
  data: ProgramInvocationData;
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
  credentials: Credentials | null;
  apiProject: ApiProject | null;
  apiUser: ApiUser | null;
  detection: { frameworkContext: Record<string, unknown> };
  eventPlan: PlannedEvent[];
  composition: {
    parentProgramId: string | null;
    completedRuns: string[];
  };
  /** The route of the latest agent run; null until one resolves. */
  binding: ResolvedBinding | null;
  /** Latched once the organization's AI SDK stamp was considered for this login. */
  aiSdkStampReported: boolean;
};

/** An agent run's final result, in completion order. */
export type SettledProgramRun = {
  runId: string;
  stepId?: string;
  result: RunResult;
};

export type AgentProgressAdapter = {
  onProgress(event: AgentProgress): void;
  finish(result: RunResult): void;
};

type RunEntry = {
  runId: string;
  stepId?: string;
  notebookUrl?: string;
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
      eventPlan: [],
      composition: { parentProgramId: null, completedRuns: [] },
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

  setEventPlan(events: PlannedEvent[]): void {
    this.data.eventPlan = structuredClone(events);
    this.emitData();
  }

  setComposition(patch: { parentProgramId: string }): void {
    this.data.composition.parentProgramId = patch.parentProgramId;
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

  markProgramCompleted(programId: string): void {
    if (this.data.composition.completedRuns.includes(programId)) return;
    this.data.composition.completedRuns.push(programId);
    this.emitData();
  }

  beginRun(
    identity: { runId: string; stepId?: string },
    observer?: (progress: ProgramRunProgress) => void,
  ): AgentProgressAdapter {
    const run: RunEntry = { ...identity };
    this.runs.push(run);

    return {
      onProgress: (event) => {
        const source = { runId: run.runId, eventKind: event.kind };
        if (run.result) {
          this.recordDiagnostic(source, 'progress after finish');
          return;
        }
        if (event.kind === 'url' && event.which === 'notebook') {
          run.notebookUrl = event.url;
        }
        if (!observer) return;
        this.deliver(source, () =>
          observer({
            kind: 'run',
            ...identity,
            event: structuredClone(event),
          }),
        );
      },
      finish: (result) => {
        run.result = result;
      },
    };
  }

  /** The unfinished run's notebook URL, for outro hooks built before the agent returns. */
  activeNotebookUrl(): string | undefined {
    for (let index = this.runs.length - 1; index >= 0; index--) {
      const run = this.runs[index];
      if (!run.result) return run.notebookUrl;
    }
    return undefined;
  }

  settledRuns(): SettledProgramRun[] {
    return this.runs.flatMap(({ runId, stepId, result }) =>
      result ? [{ runId, stepId, result }] : [],
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
