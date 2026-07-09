/**
 * The switchboard — where a program's `(sequence, harness, model)` binding is
 * resolved. Two independent middleware chains, one per axis: CLI wins over
 * PostHog flag wins over per-program binding wins over `DEFAULT_BINDING`.
 *
 * Layout: `index.ts` (shared machinery + composer), `harness.ts`, `sequence.ts`.
 * Model ids are gateway strings — add new ones as constants in `@lib/constants`.
 */

import { DEFAULT_AGENT_MODEL, Harness, Sequence } from '@lib/constants';
import type { ProgramId } from '@lib/programs/program-registry';
import { resolveHarness } from './harness';
import { resolveSequence } from './sequence';

// ── Shared machinery ────────────────────────────────────────────────────

/** Which precedence rung decided each axis. Stamped by middlewares as they assert. */
export interface SwitchboardTrace {
  harness?: 'cli' | 'flag' | 'binding';
  model?: 'cli' | 'flag' | 'binding';
  sequence?: 'cli' | 'pi-clamp' | 'flag' | 'binding';
}

/** Everything a resolver middleware may branch on. Built once per run. */
export interface SwitchboardCtx {
  program: ProgramId;
  flags: Record<string, string>;
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
}

export interface ProgramBinding {
  sequence: Sequence;
  harness: Harness;
  model: string;
  /**
   * Per-role overrides applied only in orchestrator mode — keys are
   * agent-prompt `type` values published by context-mill (`'seed'`,
   * `'install'`, `'capture'`, etc.). Linear runs use role `'default'` and
   * skip this map.
   */
  contextMillOverride?: Record<string, Partial<HarnessPick>>;
}

/** Default binding. Every program points here until it overrides. */
export const DEFAULT_BINDING: ProgramBinding = {
  sequence: Sequence.linear,
  harness: Harness.anthropic,
  model: DEFAULT_AGENT_MODEL,
};

/**
 * Per-program routing. Kept in lockstep with `PROGRAM_REGISTRY` by the
 * switchboard test. Anything absent falls back to `DEFAULT_BINDING`.
 */
export const PROGRAM_BINDINGS: Partial<Record<ProgramId, ProgramBinding>> = {
  'posthog-integration': DEFAULT_BINDING,
  'revenue-analytics-setup': DEFAULT_BINDING,
  'warehouse-source': DEFAULT_BINDING,
  'error-tracking-upload-source-maps': DEFAULT_BINDING,
  audit: DEFAULT_BINDING,
  'events-audit': DEFAULT_BINDING,
  'posthog-doctor': DEFAULT_BINDING,
  'web-analytics-doctor': DEFAULT_BINDING,
  migration: DEFAULT_BINDING,
  'self-driving': DEFAULT_BINDING,
  'agent-skill': DEFAULT_BINDING,
  'mcp-add': DEFAULT_BINDING,
  'mcp-remove': DEFAULT_BINDING,
  'mcp-tutorial': DEFAULT_BINDING,
  'mcp-analytics': DEFAULT_BINDING,
  slack: DEFAULT_BINDING,
};

// ── Unified resolver ────────────────────────────────────────────────────

/** Compose both axes. Callers needing only one axis use the per-axis resolver. */
export function resolveBinding(
  ctx: SwitchboardCtx,
  role = 'default',
): ProgramBinding {
  ctx.trace ??= {};
  const sequence = resolveSequence(ctx);
  const { harness, model } = resolveHarness(ctx, role);
  return { sequence, harness, model };
}

// ── Unified re-export surface ───────────────────────────────────────────
export { HARNESS_OPTIONS, getHarness, resolveHarness } from './harness';
export {
  SEQUENCE_OPTIONS,
  getSequence,
  resolveSequence,
  isOrchestratorEnabled,
  type SequenceRunner,
} from './sequence';
