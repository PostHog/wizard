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
 * `src/lib/programs/run-agent-legacy.ts` rebuilds today's session-driven
 * behavior on top of this call for every existing caller.
 */

import { Sequence } from '@shared/constants';
import { RunOutcome } from './shared/types';
export { RunOutcome } from './shared/types';
import { classifyRunFailure } from '@shared/errors';
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

export type {
  AbortCase,
  AgentFailure,
  BootstrapResult,
  Credentials,
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
  const collector = createProgressCollector(options.onProgress);
  const { emit } = collector;
  const log = (message: string) =>
    emit({ kind: 'log', level: 'info', message });

  // Flush the warlock scan report once, at this single seam, on every
  // termination path and for every harness (linear, orchestrator, or future).
  // flushScanReport is idempotent (it zeroes scan state), so a caller that also
  // flushes from its own cleanup path sees a harmless no-op. No harness has to
  // know reporting exists.
  try {
    const boot = await prepareRun(config, input);
    if (config.binding.sequence === Sequence.orchestrator) {
      log('Task-queue orchestrator enabled.');
    }
    logToFile(
      `[agent-runner] run program=${config.programId} sequence=${config.binding.sequence}` +
        ` harness=${config.binding.harness} composed=${config.composed}`,
    );
    const result = await getSequence(config.binding.sequence).run({
      config,
      input,
      boot,
      emit,
      interaction: options.interaction,
    });
    return {
      ...result,
      skillId: input.skillId,
      snapshot: collector.snapshot(),
    };
  } catch (error) {
    // Not a decision the agent made. Hand it back whole rather than throw, so
    // every ending of a run is a result the caller reads the same way.
    const failure = classifyRunFailure(error);
    logToFile('[agent-runner] run crashed:', error);
    return {
      outcome: RunOutcome.Crashed,
      skillId: input.skillId,
      failure: {
        code: failure.code,
        message: failure.message,
        error: error instanceof Error ? error : new Error(String(error)),
      },
      snapshot: collector.snapshot(),
    };
  } finally {
    const report = flushScanReport({ yaraReport: input.flags.yaraReport });
    if (report) log(report);
  }
}
