// Resolves routing; model additions also require mint allowlists and gateway prompt/transport support.

import { GPT5_6_SOL_MODEL, Harness, Sequence } from '@lib/constants';
import { resolveHarness } from './harness';
import type { EffortLevel } from './models';
import { resolveSequence } from './sequence';

// ── Shared machinery ────────────────────────────────────────────────────

/** Which precedence rung decided each axis. Stamped by middlewares as they assert. */
export interface SwitchboardTrace {
  harness?: 'cli' | 'flag' | 'binding';
  model?: 'cli' | 'flag' | 'binding';
  sequence?:
    | 'cli'
    | 'composed'
    | 'runtask-clamp'
    | 'payload'
    | 'flag'
    | 'binding';
}

/** Everything a resolver middleware may branch on. Built once per run. */
export interface SwitchboardCtx {
  /** Program id. An opaque label here: experiments match on it, nothing else reads it. */
  program: string;
  /**
   * The program's declared binding, resolved by the caller (see
   * `src/lib/programs/bindings.ts`). Absent → `DEFAULT_BINDING`, for
   * standalone and skill-only runs that belong to no registered program.
   */
  binding?: ProgramBinding;
  /** Composed sub-run (a dependency inside a parent program). Structurally linear — no override can orchestrate it. */
  composed?: boolean;
  flags: Record<string, string>;
  /** Flag payloads from the same snapshot (payload-carrying flags, e.g. self-driving pi). */
  flagPayloads?: Record<string, unknown>;
  /** CLI override (`--harness`). Wins over `flags`. */
  cliHarness?: Harness;
  /** CLI override (`--sequence`). Wins over `flags`. */
  cliSequence?: Sequence;
  /** CLI override (`--model`, gateway id). Wins over the binding's model. */
  cliModel?: string;
  /** Filled during resolution; read by the caller for telemetry. */
  trace?: SwitchboardTrace;
}

/** A resolver middleware: defer via `next()`, or assert by returning a value. */
export type Middleware<D> = (ctx: SwitchboardCtx, next: () => D) => D;

/**
 * Run a middleware chain over `ctx`. Each middleware receives `next` (which
 * runs the rest of the chain) and can either:
 *   - defer: call `next()` and optionally modify its result (overlay pattern)
 *   - short-circuit: return a value without calling `next()` (skip the rest)
 *
 * **Earlier in the array = higher precedence.** Index 0 runs first and can
 * short-circuit the rest; index 1 only runs if index 0 deferred. So
 * `[cliSequenceMw, orchestratorFeatureFlagMw]` means CLI takes precedence over the
 * flag, not the other way around.
 *
 * `fallback` runs at the end — reached only when every middleware deferred.
 * Typically the map read for the base value.
 */
export function runChain<D>(
  chain: Middleware<D>[],
  ctx: SwitchboardCtx,
  fallback: () => D,
): D {
  function step(index: number): D {
    if (index >= chain.length) return fallback();
    const middleware = chain[index];
    const next = () => step(index + 1);
    return middleware(ctx, next);
  }
  return step(0);
}

// ── Data model ──────────────────────────────────────────────────────────

/** Harness + model for one leaf of agent work. */
export interface HarnessPick {
  harness: Harness;
  /** Gateway model id (string). */
  model: string;
  /** Reasoning-effort override. Absent → the model's table default. */
  thinkingLevel?: EffortLevel;
}

export interface ProgramBinding {
  sequence: Sequence;
  harness: Harness;
  model: string;
  /** Reasoning-effort override for the model. Absent → the model's table default. */
  thinkingLevel?: EffortLevel;
  /**
   * Per-role overrides applied only in orchestrator mode — keys are
   * agent-prompt `type` values published by context-mill (`'seed'`,
   * `'install'`, `'capture'`, etc.). Linear runs use role `'default'` and
   * skip this map.
   */
  contextMillOverride?: Record<string, Partial<HarnessPick>>;
}

// Legacy fallback; new programs should explicitly choose Pi and prefer orchestration.
export const DEFAULT_BINDING: ProgramBinding = {
  sequence: Sequence.linear,
  harness: Harness.pi,
  model: GPT5_6_SOL_MODEL,
  thinkingLevel: 'medium',
};

/** The binding a context resolves from: the caller's, else the agent default. */
export function bindingOf(ctx: SwitchboardCtx): ProgramBinding {
  return ctx.binding ?? DEFAULT_BINDING;
}

// ── Unified resolver ────────────────────────────────────────────────────

/** Compose both axes. Callers needing only one axis use the per-axis resolver. */
export function resolveBinding(
  ctx: SwitchboardCtx,
  role = 'default',
): ProgramBinding {
  ctx.trace ??= {};
  const sequence = resolveSequence(ctx);
  const { harness, model, thinkingLevel } = resolveHarness(ctx, role);
  return { sequence, harness, model, thinkingLevel };
}

// ── Unified re-export surface ───────────────────────────────────────────
export { HARNESS_OPTIONS, getHarness, resolveHarness } from './harness';
export {
  SEQUENCE_OPTIONS,
  getSequence,
  resolveSequence,
  type SequenceRunner,
} from './sequence';
export {
  isOrchestratorEnabled,
  areSeededTasksEnabled,
  resolveStageOverrides,
} from './flags';
