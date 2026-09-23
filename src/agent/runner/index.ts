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
 * exits the process and never rejects. A decided failure comes back in
 * `RunResult.failure` with the same fields `wizardAbort` takes; an error the
 * agent did not decide (a refused mint, an SDK crash) comes back as
 * `outcome: RunOutcome.Crashed` with the original error attached, so a caller can keep
 * handling it the way it always did. The legacy adapter in
 * `src/cli/runners/run-program-agent.ts` rebuilds today's session-driven
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
  const snapshot = (): RunResult['snapshot'] => {
    try {
      if (collector) return collector.snapshot();
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
  let cleanupInstalledSkills: (() => void) | undefined;
  const cleanFailedRun = () => {
    try {
      cleanupInstalledSkills?.();
    } catch (error) {
      try {
        logToFile('[agent-runner] failed-run skill cleanup error:', error);
      } catch {
        // Logging is best effort.
      }
    }
  };
  const cancelled = (): RunResult => ({
    ...hostAborted(),
    skillId: input.skillId,
    snapshot: snapshot(),
  });
  // Every ending passes through here once the outcome is decided: clean the
  // skills a failed run installed, then flush the warlock scan report at this
  // single seam for every harness. flushScanReport is idempotent (it zeroes
  // scan state), so a caller that also flushes sees a harmless no-op.
  const finish = (result: RunResult): RunResult => {
    if (result.outcome !== RunOutcome.Success) cleanFailedRun();
    try {
      const report = flushScanReport({ yaraReport: input.flags.yaraReport });
      if (report)
        collector?.emit({ kind: 'log', level: 'info', message: report });
    } catch {
      // Scan reporting is best effort after the run outcome is decided.
    }
    return result;
  };

  try {
    collector = createProgressCollector(options.onProgress);
    const { emit } = collector;
    const log = (message: string) =>
      emit({ kind: 'log', level: 'info', message });
    // Capture before preparation so pre-harness failures also clean new skills.
    cleanupInstalledSkills = captureRunSkillCleanup(input.installDir);
    if (options.signal?.aborted) return finish(cancelled());
    const boot = await prepareRun(config, input);
    if (options.signal?.aborted) return finish(cancelled());
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
    });
    // A host cancellation replaces a success only. A terminal failure the run
    // already decided is the more specific outcome and stays.
    if (
      options.signal?.aborted &&
      sequenceResult.outcome === RunOutcome.Success
    ) {
      return finish(cancelled());
    }
    return finish({
      ...sequenceResult,
      skillId: input.skillId,
      snapshot: snapshot(),
    });
  } catch (error) {
    // Not a decision the agent made. Hand it back whole rather than throw, so
    // every ending of a run is a result the caller reads the same way.
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
      return finish({
        outcome: RunOutcome.Failed,
        skillId: input?.skillId,
        failure: {
          code: failure.code,
          message: failure.message,
          error: original,
        },
        snapshot: snapshot(),
      });
    }
    if (options.signal?.aborted && abortError) return finish(cancelled());
    return finish({
      outcome: RunOutcome.Crashed,
      skillId: input?.skillId,
      failure: {
        code: failure.code,
        message: failure.message,
        error: original,
      },
      snapshot: snapshot(),
    });
  }
}

function safeErrorMessage(error: unknown): string {
  try {
    return String(error);
  } catch {
    return 'Unknown thrown value';
  }
}
