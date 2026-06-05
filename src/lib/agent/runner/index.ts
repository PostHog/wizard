/**
 * Runner seam.
 *
 * The program pipeline (agent-runner.ts) drives an agent run through a
 * `Runner` rather than calling a model SDK directly. This is the seam the
 * model-agnostic runner work hangs off: each backend wraps an existing agent
 * SDK that owns the loop/tools/streaming, and `selectRunner` chooses between
 * them by the multivariate `wizard-runner` flag.
 *
 * - `anthropic` — today's `@anthropic-ai/claude-agent-sdk` path (default).
 * - `pi`        — OpenAI Agents SDK (lands in #524).
 * - `vercel`    — Vercel AI SDK (lands in #523).
 *
 * This module is pure machinery — it carries no product knowledge.
 */
import { WIZARD_RUNNER_FLAG_KEY } from '../../constants';
import { logToFile } from '../../../utils/debug';
import type { runAgent } from '../agent-interface';
import { AnthropicRunner } from './anthropic-runner';
import { VercelRunner } from './vercel/vercel-runner';

/** The agent backends the `wizard-runner` flag can select. */
export type WizardRunnerVariant = 'anthropic' | 'pi' | 'vercel';

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
 * Resolve the `wizard-runner` flag to a known variant. Anything unrecognized
 * — including an absent value from a flag-fetch failure — resolves to
 * `anthropic`, so the SDK path is always the safe default.
 */
export function resolveRunnerVariant(
  flags: Record<string, string>,
): WizardRunnerVariant {
  const value = flags[WIZARD_RUNNER_FLAG_KEY];
  return value === 'pi' || value === 'vercel' ? value : 'anthropic';
}

/**
 * Select the runner for this run and log which backend executed.
 *
 * The `pi` runner lands in #524; until then it falls back to `AnthropicRunner`
 * so the flag stays wired and observable without changing behavior. An unknown
 * value already resolved to `anthropic` in {@link resolveRunnerVariant}.
 */
export function selectRunner(flags: Record<string, string>): Runner {
  const variant = resolveRunnerVariant(flags);
  switch (variant) {
    case 'vercel':
      logToFile('[runner] wizard-runner=vercel → VercelRunner');
      return new VercelRunner();
    case 'pi':
      logToFile(
        '[runner] wizard-runner=pi → AnthropicRunner (fallback — not yet implemented)',
      );
      return new AnthropicRunner();
    case 'anthropic':
    default:
      logToFile('[runner] wizard-runner=anthropic → AnthropicRunner');
      return new AnthropicRunner();
  }
}
