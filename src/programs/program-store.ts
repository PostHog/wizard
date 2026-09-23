import type {
  AgentProgress,
  ResolvedBinding,
  RunResult,
} from '../agent/types.js';
import type { ApiProject, ApiUser, Credentials } from '../shared/api.js';
import type { Integration } from '../shared/constants.js';
import { appendStatus } from '../shared/status-history.js';
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

type RunProjectionBase = {
  runId: string;
  stepId?: string;
  snapshot: RunResult['snapshot'];
  skillId?: string;
  outro?: Extract<AgentProgress, { kind: 'completion' }>['outro'];
};

export type ProgramRunProjection = RunProjectionBase &
  (
    | { phase: 'pending' | 'running'; outcome?: never }
    | { phase: 'finished'; outcome: RunResult['outcome'] }
  );

/** What a diagnostic is about: one run's progress event, or a data snapshot. */
type DiagnosticSource =
  | { runId: string; eventKind: AgentProgress['kind'] }
  | { eventKind: 'data' };

export type ProgramStoreProjection = {
  runs: ProgramRunProjection[];
  diagnostics: (DiagnosticSource & { message: string })[];
};

/** Data owned by one program invocation, independent of its progress feed. */
export type ProgramInvocationData = {
  credentials: Credentials | null;
  apiProject: ApiProject | null;
  apiUser: ApiUser | null;
  detection: {
    integration: Integration | null;
    typescript: boolean;
    detectedFrameworkLabel: string | null;
    complete: boolean;
    frameworkContext: Record<string, unknown>;
  };
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

export type ProgramInvocationDataInit = Partial<
  Pick<
    ProgramInvocationData,
    | 'credentials'
    | 'apiProject'
    | 'apiUser'
    | 'eventPlan'
    | 'aiSdkStampReported'
  >
> & {
  detection?: Partial<ProgramInvocationData['detection']>;
  composition?: Partial<ProgramInvocationData['composition']>;
};

/** An actual result accepted by finish(), in completion order. */
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
  state:
    | { phase: 'pending' | 'running' }
    | { phase: 'finished'; result: RunResult };
  snapshot: RunResult['snapshot'];
  outro?: Extract<AgentProgress, { kind: 'completion' }>['outro'];
};

const MAX_DIAGNOSTICS = 10;

function emptySnapshot(): RunResult['snapshot'] {
  return {
    tasks: [],
    statusMessages: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    },
  };
}

const isDataCloneError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'DataCloneError';

function cloneRunResult(result: RunResult): RunResult {
  if (result.outcome === 'success' || !result.failure.error)
    return structuredClone(result);

  const source = result.failure.error;
  const withoutError = (): RunResult => {
    const clone = structuredClone({
      ...result,
      failure: { ...result.failure, error: undefined },
    }) as RunResult;
    if (clone.outcome !== 'success') clone.failure.error = source;
    return clone;
  };
  let clone: RunResult;
  try {
    clone = structuredClone(result);
  } catch (error) {
    if (!isDataCloneError(error)) throw error;
    return withoutError();
  }
  if (!clone.failure.error) return clone;

  try {
    const target = clone.failure.error;
    const prototype = Object.getPrototypeOf(source) as object | null;
    Object.setPrototypeOf(target, prototype);
    for (const key of Reflect.ownKeys(source)) {
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (!descriptor) continue;
      if ('value' in descriptor) {
        const value: unknown = descriptor.value;
        descriptor.value = structuredClone(value);
      }
      Object.defineProperty(target, key, descriptor);
    }
    return clone;
  } catch (error) {
    if (!isDataCloneError(error)) throw error;
    return withoutError();
  }
}

function applyAgentProgress(run: RunEntry, event: AgentProgress): void {
  switch (event.kind) {
    case 'lifecycle':
      if (event.phase === 'started') run.state = { phase: 'running' };
      break;
    case 'tasks':
      run.snapshot.tasks = event.tasks.map((task) => ({ ...task }));
      break;
    case 'status':
      run.snapshot.statusMessages = appendStatus(
        run.snapshot.statusMessages,
        event.message,
      );
      break;
    case 'stage':
      run.snapshot.stage = event.stage;
      break;
    case 'url':
      if (event.which === 'dashboard') run.snapshot.dashboardUrl = event.url;
      else run.snapshot.notebookUrl = event.url;
      break;
    case 'usage':
      run.snapshot.usage.inputTokens += event.delta.inputTokens;
      run.snapshot.usage.outputTokens += event.delta.outputTokens;
      run.snapshot.usage.cacheReadTokens += event.delta.cacheReadTokens;
      run.snapshot.usage.cacheCreationTokens += event.delta.cacheCreationTokens;
      break;
    case 'finalCost':
      run.snapshot.finalCostUsd = event.usd;
      break;
    case 'handoff':
      run.snapshot.handoffText = event.text;
      break;
    case 'spinner':
    case 'log':
    case 'authError':
      break;
    case 'completion':
      run.outro = structuredClone(event.outro);
      break;
    default: {
      const unhandled: never = event;
      throw new Error(`Unhandled agent progress: ${JSON.stringify(unhandled)}`);
    }
  }
}

/** Setter surface a host control port may expose (C2c, B2-30). Type only. */
export type ProgramDataWriter = Pick<
  ProgramStore,
  | 'setAuthenticated'
  | 'setDetection'
  | 'setFrameworkContext'
  | 'setEventPlan'
  | 'setComposition'
  | 'markProgramCompleted'
>;

export class ProgramStore {
  private readonly runs: RunEntry[] = [];
  private readonly settled: SettledProgramRun[] = [];
  private readonly diagnostics: ProgramStoreProjection['diagnostics'] = [];
  private readonly data: ProgramInvocationData;
  private readonly onData?: (progress: ProgramDataProgress) => void;

  constructor(
    initial: ProgramInvocationDataInit = {},
    options: { onData?: (progress: ProgramDataProgress) => void } = {},
  ) {
    this.onData = options.onData;
    this.data = structuredClone({
      credentials: initial.credentials ?? null,
      apiProject: initial.apiProject ?? null,
      apiUser: initial.apiUser ?? null,
      detection: {
        integration: initial.detection?.integration ?? null,
        typescript: initial.detection?.typescript ?? false,
        detectedFrameworkLabel:
          initial.detection?.detectedFrameworkLabel ?? null,
        complete: initial.detection?.complete ?? false,
        frameworkContext: initial.detection?.frameworkContext ?? {},
      },
      eventPlan: initial.eventPlan ?? [],
      composition: {
        parentProgramId: initial.composition?.parentProgramId ?? null,
        completedRuns: initial.composition?.completedRuns ?? [],
      },
      binding: null,
      aiSdkStampReported: initial.aiSdkStampReported ?? false,
    });
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

  setDetection(
    patch: Partial<
      Omit<ProgramInvocationData['detection'], 'frameworkContext'>
    >,
  ): void {
    if (patch.integration !== undefined) {
      this.data.detection.integration = patch.integration;
    }
    if (patch.typescript !== undefined) {
      this.data.detection.typescript = patch.typescript;
    }
    if (patch.detectedFrameworkLabel !== undefined) {
      this.data.detection.detectedFrameworkLabel = patch.detectedFrameworkLabel;
    }
    if (patch.complete !== undefined) {
      this.data.detection.complete = patch.complete;
    }
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

  setComposition(patch: Partial<ProgramInvocationData['composition']>): void {
    if (patch.parentProgramId !== undefined) {
      this.data.composition.parentProgramId = patch.parentProgramId;
    }
    if (patch.completedRuns !== undefined) {
      this.data.composition.completedRuns = [...patch.completedRuns];
    }
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
    if (this.runs.some((run) => run.runId === identity.runId)) {
      throw new Error(`Duplicate program run id: ${identity.runId}`);
    }
    const run: RunEntry = {
      ...identity,
      state: { phase: 'pending' },
      snapshot: emptySnapshot(),
    };
    this.runs.push(run);

    return {
      onProgress: (event) => {
        const source = { runId: run.runId, eventKind: event.kind };
        if (run.state.phase === 'finished') {
          this.recordDiagnostic(source, 'progress after finish');
          return;
        }
        applyAgentProgress(run, event);
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
        if (run.state.phase === 'finished') {
          throw new Error(`Program run already finished: ${run.runId}`);
        }
        const ownedResult = cloneRunResult(result);
        run.snapshot = structuredClone(ownedResult.snapshot);
        const finalOutro =
          ownedResult.outcome === 'success'
            ? ownedResult.outro
            : ownedResult.failure.outroData;
        if (finalOutro) run.outro = structuredClone(finalOutro);
        run.state = { phase: 'finished', result: ownedResult };
        this.settled.push({
          runId: run.runId,
          stepId: run.stepId,
          result: ownedResult,
        });
      },
    };
  }

  settledRuns(): SettledProgramRun[] {
    return this.settled.map((run) => ({
      runId: run.runId,
      stepId: run.stepId,
      result: cloneRunResult(run.result),
    }));
  }

  read(): ProgramStoreProjection {
    return {
      runs: this.runs.map((run): ProgramRunProjection => {
        const base = {
          runId: run.runId,
          stepId: run.stepId,
          snapshot: structuredClone(run.snapshot),
          skillId:
            run.state.phase === 'finished'
              ? run.state.result.skillId
              : undefined,
          outro: run.outro ? structuredClone(run.outro) : undefined,
        };
        return run.state.phase === 'finished'
          ? { ...base, phase: 'finished', outcome: run.state.result.outcome }
          : { ...base, phase: run.state.phase };
      }),
      diagnostics: this.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    };
  }

  results(): RunResult[] {
    return this.runs.flatMap((run) =>
      run.state.phase === 'finished' ? [cloneRunResult(run.state.result)] : [],
    );
  }

  private emitData(): void {
    const onData = this.onData;
    if (!onData) return;
    let data: ProgramInvocationData;
    try {
      data = structuredClone(this.data);
    } catch (error) {
      if (!isDataCloneError(error)) throw error;
      this.recordDiagnostic({ eventKind: 'data' }, error);
      return;
    }
    this.deliver({ eventKind: 'data' }, () =>
      onData({ kind: 'program', data }),
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
