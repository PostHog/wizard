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
 * handling it the way it always did. Every host reaches this call through
 * programs' `runProgram`, which builds the config and input; a standalone
 * caller builds them itself.
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
import { flushScanReport } from '@agent/yara-hooks';
import type { ProgressEmitter } from '@agent/progress';
import { captureRunSkillCleanup } from '@shared/skill-run-cleanup';
import { registerCleanup } from '@utils/cleanup-registry';
import { hostAborted } from './shared/errors';

export type {
  AbortCase,
  AgentFailure,
  BootstrapResult,
  Credentials,
  InferenceAuthProvider,
  AgentRunDefinition,
  PromptContext,
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
} from '@agent/progress';
export type { ProgramBinding, SwitchboardCtx } from './switchboard';
export { TASK_OUTCOMES_KEY } from './sequence/orchestrator/queue';
export type { TaskOutcome } from './sequence/orchestrator/queue';

/**
 * Run a program's agent pipeline.
 *
 * Prepare → dispatch to the sequence the binding names → return its result
 * with the agent's own snapshot of what it reported. Missing observers change
 * nothing; a throwing observer is logged and the run continues.
 */
export async function runAgent(
  config: RunConfig,
  input: RunInput,
  options: RunAgentOptions = {},
): Promise<RunResult> {
  let collector: ReturnType<typeof createProgressCollector> | undefined;
  let scanReport: { flush(): void } | undefined;
  let transcript: TranscriptTail | undefined;
  let cleanupInstalledSkills: (() => void) | undefined;
  const cleanFailedRun = () => {
    try {
      cleanupInstalledSkills?.();
    } catch (error) {
      try {
        logToFile('[agent-runner] failed-run skill cleanup error:', error);
      } catch {
        // Cleanup diagnostics must not replace the run result.
      }
    }
  };
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
  const settle = (result: RunResult): RunResult => {
    if (result.outcome !== RunOutcome.Success) cleanFailedRun();
    try {
      // A deferred report keeps counting this run's scans toward the host run's.
      scanReport?.flush();
    } catch {
      // Scan reporting is best effort after the run outcome is decided.
    }
    return result;
  };
  let result: RunResult;
  try {
    // The report line reaches the collector once it exists; a drain cannot run before that.
    if (config.scanReport !== 'defer') {
      scanReport = armScanReportFlush(input.flags.yaraReport, (event) =>
        collector?.emit(event),
      );
    }
    // The standalone contract: capture before preparation so pre-harness failures clean new skills too.
    cleanupInstalledSkills = captureRunSkillCleanup(input.installDir);
    collector = createProgressCollector(options.onProgress);
    const { emit } = collector;
    if (config.run.collectTranscript) transcript = createTranscriptTail(emit);
    const log = (message: string) =>
      emit({ kind: 'log', level: 'info', message });
    if (options.signal?.aborted) {
      return settle({
        ...hostAborted(),
        skillId: input.skillId,
        snapshot: snapshot(),
      });
    }
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
      ...(options.signal?.aborted ? hostAborted() : sequenceResult),
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
    if (options.signal?.aborted) {
      result = {
        ...hostAborted(),
        skillId: input.skillId,
        snapshot: snapshot(),
      };
    } else if (failure.coded) {
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
  return settle(result);
}

/**
 * Write the scan report and emit its line once: from the run's own tail, or
 * earlier when a process drain (wizardAbort, a signal handler) runs cleanups.
 */
function armScanReportFlush(
  yaraReport: boolean,
  emit: ProgressEmitter,
): { flush(): void } {
  let flushed = false;
  const flush = () => {
    if (flushed) return;
    flushed = true;
    const report = flushScanReport({ yaraReport });
    if (report) emit({ kind: 'log', level: 'info', message: report });
  };
  registerCleanup(flush);
  return { flush };
}

function safeErrorMessage(error: unknown): string {
  try {
    return String(error);
  } catch {
    return 'Unknown thrown value';
  }
}
