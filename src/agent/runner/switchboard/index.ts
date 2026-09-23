// Resolves routing; model additions also require mint allowlists and gateway prompt/transport support.

import { Harness, Sequence } from '@shared/constants';
import { DEFAULT_AGENT_BINDING } from '@agent/default-binding';
import type { EffortLevel } from './models';

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
  /** Opaque log label. Program lookup stays with the caller. */
  program?: string;
  /** The caller's selected base binding, before route/CLI overlays. */
  baseBinding?: ProgramBinding;
  /** Composed sub-run (a dependency inside a parent program). Structurally linear — no override can orchestrate it. */
  composed?: boolean;
  /** Already validated experiment route; no flag parsing happens in the agent. */
  flagRoute?: {
    harness?: Harness;
    model?: string;
    thinkingLevel?: EffortLevel;
    sequence?: Sequence;
  };
  flagSequence?: Sequence;
  /** Raw boolean only for the existing capability-clamp log line. */
  orchestratorFlagOn?: boolean;
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

/** The harness axis's fallback when the caller supplies no base binding. */
export const DEFAULT_BINDING: ProgramBinding = DEFAULT_AGENT_BINDING;

// ── Unified re-export surface ───────────────────────────────────────────
export {
  HARNESS_OPTIONS,
  getHarness,
  harnessRunsTasks,
  resolveHarness,
} from './harness';
export { SEQUENCE_OPTIONS, getSequence, type SequenceRunner } from './sequence';
export { resolveRoleHarness } from './harness';
