import type { AgentProgress, RunResult } from '../agent/types.js';
import { appendStatus } from '../shared/status-history.js';

export type ProgramProgress = {
  runId: string;
  stepId?: string;
  event: AgentProgress;
};

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

export type ProgramStoreProjection = {
  runs: ProgramRunProjection[];
  diagnostics: {
    runId: string;
    eventKind: AgentProgress['kind'];
    message: string;
  }[];
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

function cloneRunResult(result: RunResult): RunResult {
  const clone = structuredClone(result);
  if (
    result.outcome !== 'success' &&
    clone.outcome !== 'success' &&
    result.failure.error &&
    clone.failure.error
  ) {
    const source = result.failure.error;
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
  }
  return clone;
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

export class ProgramStore {
  private readonly runs: RunEntry[] = [];
  private readonly diagnostics: ProgramStoreProjection['diagnostics'] = [];

  beginRun(
    identity: { runId: string; stepId?: string },
    observer?: (progress: ProgramProgress) => void,
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
        if (run.state.phase === 'finished') {
          this.recordDiagnostic(run.runId, event.kind, 'progress after finish');
          return;
        }
        applyAgentProgress(run, event);
        if (!observer) return;
        try {
          const delivery: unknown = observer({
            ...identity,
            event: structuredClone(event),
          });
          if (
            delivery &&
            typeof (delivery as PromiseLike<unknown>).then === 'function'
          ) {
            void Promise.resolve(delivery).catch((error: unknown) => {
              this.recordDiagnostic(run.runId, event.kind, error);
            });
          }
        } catch (error) {
          this.recordDiagnostic(run.runId, event.kind, error);
        }
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
      },
    };
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

  private recordDiagnostic(
    runId: string,
    eventKind: AgentProgress['kind'],
    error: unknown,
  ): void {
    this.diagnostics.push({
      runId,
      eventKind,
      message: error instanceof Error ? error.message : String(error),
    });
    if (this.diagnostics.length > MAX_DIAGNOSTICS) this.diagnostics.shift();
  }
}
