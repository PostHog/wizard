/**
 * Runner seam.
 *
 * The program pipeline (agent-runner.ts) drives an agent run through a
 * `Runner` rather than calling the SDK directly. This is the single seam the
 * Anthropic-SDK-replacement work hangs off: today only `SdkRunner` exists
 * (it delegates to the SDK-backed `runAgent` in agent-interface.ts), and a
 * future open-code runner (`HarnessRunner`) will implement the same contract
 * against the PostHog gateway. `selectRunner` chooses between them by feature
 * flag.
 *
 * This module is pure machinery — it carries no product knowledge.
 */
import { WIZARD_OPEN_CODE_RUNNER_FLAG_KEY } from '../../constants';
import { logToFile } from '../../../utils/debug';
import type { runAgent } from '../agent-interface';
import { SdkRunner } from './sdk-runner';

/** Arguments accepted by a runner — mirrors `runAgent` exactly. */
export type RunnerRunArgs = Parameters<typeof runAgent>;
/** Result produced by a runner — mirrors `runAgent` exactly. */
export type RunnerResult = Awaited<ReturnType<typeof runAgent>>;

/**
 * Execution backend for an agent run. Implementations are interchangeable:
 * they take the same arguments as `runAgent` and resolve to the same result,
 * so the pipeline neither knows nor cares which one it holds.
 */
export interface Runner {
  run(...args: RunnerRunArgs): Promise<RunnerResult>;
}

/**
 * Whether this run opts into the new open-code runner.
 *
 * `wizard-open-code-runner` is a boolean flag (default off). Enabled means
 * `'true'`; anything else — including an absent value from a flag-fetch
 * failure — means off, so the SDK path is always the safe default.
 */
export function isOpenCodeRunnerEnabled(
  flags: Record<string, string>,
): boolean {
  return flags[WIZARD_OPEN_CODE_RUNNER_FLAG_KEY] === 'true';
}

/**
 * Select the runner for this run from the wizard feature flags.
 *
 * The open-code runner (`HarnessRunner`) does not exist at this layer yet, so
 * `selectRunner` always returns `SdkRunner` here — the flag is wired but inert
 * until the runner lands (PR 02+). That keeps this seam a behavior-preserving
 * refactor regardless of the flag's value.
 */
export function selectRunner(flags: Record<string, string>): Runner {
  const useOpenCodeRunner = isOpenCodeRunnerEnabled(flags);
  // TODO(open-code): return new HarnessRunner() when useOpenCodeRunner once the
  // in-house loop exists (PR 02+). Until then every run uses the SDK.
  logToFile(
    `[runner] wizard-open-code-runner=${useOpenCodeRunner} — running SDK runner (open-code runner not yet available)`,
  );
  return new SdkRunner();
}
