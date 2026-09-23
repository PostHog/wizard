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
 * handling it the way it always did. The legacy adapter in
 * `src/programs/run-agent-legacy.ts` rebuilds today's session-driven
 * behavior on top of this call for every existing caller.
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
import { captureRunSkillCleanup } from '@shared/skill-run-cleanup';
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
export { shouldDisableAsk } from './shared/bootstrap';
export { resolveBinding } from './switchboard';
export type { ProgramBinding, SwitchboardCtx } from './switchboard';

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

  let result: RunResult;
  try {
    // Capture before preparation so pre-harness failures also clean new skills.
    cleanupInstalledSkills = captureRunSkillCleanup(input.installDir);
    collector = createProgressCollector(options.onProgress);
    const { emit } = collector;
    if (config.run.collectTranscript) transcript = createTranscriptTail(emit);
    const log = (message: string) =>
      emit({ kind: 'log', level: 'info', message });
    if (options.signal?.aborted) {
      result = {
        ...hostAborted(),
        skillId: input.skillId,
        snapshot: snapshot(),
      };
    } else {
      const boot = await prepareRun(config, input);
      if (options.signal?.aborted) {
        result = {
          ...hostAborted(),
          skillId: input.skillId,
          snapshot: snapshot(),
        };
      } else {
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
      }
    }
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
        skillId: input.skillId,
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
        skillId: input.skillId,
        failure: {
          code: failure.code,
          message: failure.message,
          error: original,
        },
        snapshot: snapshot(),
      };
    }
  }

  if (options.signal?.aborted && result.outcome === RunOutcome.Success) {
    result = { ...hostAborted(), skillId: input.skillId, snapshot: snapshot() };
  }
  if (result.outcome !== RunOutcome.Success) cleanFailedRun();
  // A deferred report keeps counting this run's scans toward the host run's.
  if (config.scanReport !== 'defer') {
    try {
      const report = flushScanReport({ yaraReport: input.flags.yaraReport });
      if (report)
        collector?.emit({ kind: 'log', level: 'info', message: report });
    } catch {
      // Scan reporting is best effort after the run outcome is decided.
    }
  }
  return result;
}

function safeErrorMessage(error: unknown): string {
  try {
    return String(error);
  } catch {
    return 'Unknown thrown value';
  }
}
