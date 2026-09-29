/**
 * Unified program runner — dispatcher.
 *
 * One callable, `runAgent(config, input, options)`, runs a program's agent
 * pipeline to a decided result. `config` is resolved execution data (which
 * program, how it is routed, which flags apply); `input` is the invocation
 * snapshot (directory, credentials, project); `options` carries an optional
 * progress observer, an optional answerer.
 *
 * The pipeline prepares the run (logging targets, gateway mint, scan triage),
 * then forks. The `orchestrator` variant routes to the task-queue runner.
 * Every other variant runs the fixed linear pipeline:
 *   [skill install] → agent init → prompt → run → errors → [postRun] → outro
 *
 * The agent reports and asks, it never renders, never reads a session, never
 * exits the process, never sends the process's terminal analytics and never
 * rejects. A decided failure comes back in
 * `RunResult.failure` with the same fields `wizardAbort` takes; an error the
 * agent did not decide (a refused mint, an SDK crash) comes back as
 * `outcome: RunOutcome.Crashed` with the original error attached, so a caller can keep
 * handling it the way it always did. `runProgram` is the program layer's caller.
 */

import { Sequence } from '@shared/constants';
import { RunOutcome } from './shared/types';
export { RunOutcome } from './shared/types';
import { classifyRunFailure, ErrorCodes } from '@shared/errors';
import { logToFile } from '@utils/debug';
import type {
  RunAgentOptions,
  RunConfig,
  RunInput,
  RunResult,
} from './shared/types';
import { prepareRun } from './shared/bootstrap';
import { createProgressCollector } from './shared/progress-collector';
import {
  createTranscriptTail,
  type TranscriptTail,
} from './shared/transcript-tail';
import { getSequence } from './switchboard';
import { resolveRunConfig } from './switchboard/resolve-run';
import { flushScanReport } from '../yara-hooks';
import { registerCleanup } from '@utils/cleanup';
import { useRunGatewayCredential } from '../gateway-session';

export type {
  AbortCase,
  AgentFailure,
  BootstrapResult,
  Credentials,
  AgentRunDefinition,
  PromptContext,
  AgentRouting,
  ResolvedBinding,
  RunAgentOptions,
  RunConfig,
  RunFlags,
  RunHooks,
  RunInput,
  RunResult,
  RunSnapshot,
  SeedTaskEntry,
} from './shared/types';
export type {
  AgentInteraction,
  AgentProgress,
  ProgressEmitter,
} from '../progress';
export { DEFAULT_BINDING } from './switchboard';
export type { AgentBinding } from './switchboard';
export type { TaskOutcome } from './sequence/orchestrator/queue';

/**
 * Run a program's agent pipeline.
 *
 * Prepare → dispatch to the sequence the binding names → return its result
 * with the agent's own snapshot of what it reported. Missing observers change
 * nothing; a throwing observer is logged and the run continues.
 */
export async function runAgent(
  runConfig: RunConfig,
  input: RunInput,
  options: RunAgentOptions = {},
): Promise<RunResult> {
  let collector: ReturnType<typeof createProgressCollector> | undefined;
  let transcript: TranscriptTail | undefined;
  const snapshot = (): RunResult['snapshot'] => {
    try {
      if (collector) {
        const collected = collector.snapshot();
        return transcript
          ? { ...collected, transcriptTail: transcript.text() }
          : collected;
      }
    } catch {
      // A partial snapshot must not replace the run's primary failure.
    }
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
  };
  let unregisterFlush: (() => void) | undefined;
  const flushReport = (): void => {
    unregisterFlush?.();
    // A deferred report keeps counting this run's scans toward the program run's.
    if (runConfig.scanReport === 'defer') return;
    try {
      const report = flushScanReport({ yaraReport: input.flags.yaraReport });
      if (report)
        collector?.emit({ kind: 'log', level: 'info', message: report });
    } catch {
      // Scan reporting is best effort after the run outcome is decided.
    }
  };
  let result: RunResult;
  try {
    collector = createProgressCollector(options.onProgress);
    // An exit mid-run still reports the scans so far; the report is idempotent.
    unregisterFlush = registerCleanup(flushReport);
    const { emit } = collector;
    if (runConfig.run.collectTranscript)
      transcript = createTranscriptTail(emit);
    const log = (message: string) =>
      emit({ kind: 'log', level: 'info', message });
    if (options.signal?.aborted) {
      flushReport();
      return {
        outcome: RunOutcome.Aborted,
        skillId: input.skillId,
        failure: {
          code: ErrorCodes.AgentAbort,
          message: 'Agent run cancelled',
        },
        snapshot: snapshot(),
      };
    }
    // A pre-issued gateway token (dev and test CI runs) stands in for the mint, for this run only.
    useRunGatewayCredential(
      input.credentials.gateway,
      input.credentials.projectId,
    );
    const config = resolveRunConfig(runConfig);
    emit({ kind: 'binding', binding: config.binding });
    const boot = await prepareRun(config, input);
    if (config.binding.sequence === Sequence.orchestrator) {
      log('Task-queue orchestrator enabled.');
    }
    try {
      logToFile(
        `[agent-runner] run program=${config.programId} sequence=${config.binding.sequence}` +
          ` harness=${config.binding.harness} composed=${config.composed}`,
      );
    } catch {
      // Logging is best effort.
    }
    const sequenceResult = await getSequence(config.binding.sequence).run({
      config,
      input,
      boot,
      emit,
      interaction: options.interaction,
      signal: options.signal,
      transcript,
    });
    result = {
      ...(options.signal?.aborted &&
      sequenceResult.outcome === RunOutcome.Success
        ? {
            outcome: RunOutcome.Aborted as const,
            failure: {
              code: ErrorCodes.AgentAbort,
              message: 'Agent run cancelled',
            },
          }
        : sequenceResult),
      skillId: input.skillId,
      snapshot: snapshot(),
    };
  } catch (error) {
    const original =
      error instanceof Error ? error : new Error(safeErrorMessage(error));
    let failure: ReturnType<typeof classifyRunFailure>;
    try {
      failure = classifyRunFailure(original);
    } catch {
      failure = {
        code: ErrorCodes.InternalUnhandled,
        message: 'Unexpected agent error',
        coded: false,
      };
    }
    try {
      logToFile('[agent-runner] run failed:', original);
    } catch {
      // Logging is best effort.
    }
    let abortError = false;
    try {
      abortError = original.name === 'AbortError';
    } catch {
      /* Hostile Error getter. */
    }
    if (failure.coded) {
      result = {
        outcome: RunOutcome.Failed,
        skillId: input?.skillId,
        failure: {
          code: failure.code,
          message: failure.message,
          error: original,
        },
        snapshot: snapshot(),
      };
    } else if (options.signal?.aborted && abortError) {
      result = {
        outcome: RunOutcome.Aborted,
        skillId: input?.skillId,
        failure: {
          code: ErrorCodes.AgentAbort,
          message: 'Agent run cancelled',
        },
        snapshot: snapshot(),
      };
    } else {
      result = {
        outcome: RunOutcome.Crashed,
        skillId: input?.skillId,
        failure: {
          code: failure.code,
          message: failure.message,
          error: original,
        },
        snapshot: snapshot(),
      };
    }
  }
  flushReport();
  return result;
}

function safeErrorMessage(error: unknown): string {
  try {
    return String(error);
  } catch {
    return 'Unknown thrown value';
  }
}
