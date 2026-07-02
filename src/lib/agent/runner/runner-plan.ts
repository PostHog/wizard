/**
 * The agent-runner plan — the one central place that decides how a program runs.
 *
 * A program maps (via the `ROUTES` config map) to a **router** (control-flow
 * shape: `linear` | `orchestrator`) and a **(runner, model) pair**. The base
 * decision is just the map read; control is then asserted at named insertion
 * points (`resolvePair` here; `resolveRouter` arrives with the flag middleware)
 * — each an ordered middleware chain whose terminal is the map. Existing flags
 * plug in as middleware, one per flag (see #692b); the core never reads a flag.
 *
 * Two registries bound by pairs:
 *   RUNNERS  leaf engines (`anthropic` now; `pi` registers later)
 *   MODELS   model alias → gateway id (retires the hardcoded model literals)
 */

import {
  DEFAULT_AGENT_MODEL,
  WIZARD_RUNNER_FLAG_KEY,
  Harness,
  Sequence,
} from '@lib/constants';
import { IS_PRODUCTION_BUILD } from '@env';
import { logToFile } from '@utils/debug';
import type { ProgramId } from '@lib/programs/program-registry';
import type { AgentRunner } from './harness/types';
import { anthropicBackend } from './harness/anthropic';
import { piBackend } from './harness/pi';

/** Legacy alias — new code should use `Harness` from `@lib/constants`. */
export type RunnerName = Harness;
/** Legacy alias — new code should use `Sequence` from `@lib/constants`. */
export type RouterName = Sequence;
export type ModelAlias = 'sonnet' | 'opus' | 'gpt5';

/** What a leaf of agent work resolves to. */
export interface Pair {
  runner: RunnerName;
  model: ModelAlias;
}

/** Model alias → gateway model id. Replaces the hardcoded model literals. */
export const MODELS: Record<ModelAlias, string> = {
  sonnet: DEFAULT_AGENT_MODEL,
  opus: 'claude-opus-4-8',
  // OpenAI-class peer of sonnet, served by the gateway over OpenAI completions.
  gpt5: 'openai/gpt-5',
};

/** Leaf engines. */
export const RUNNERS: Partial<Record<RunnerName, AgentRunner>> = {
  anthropic: anthropicBackend,
  pi: piBackend,
};

/** Look up a registered runner, or fail loudly if a route names an absent one. */
export function getRunner(name: RunnerName): AgentRunner {
  const runner = RUNNERS[name];
  if (!runner) {
    throw new Error(`No agent runner registered for '${name}'.`);
  }
  return runner;
}

/**
 * A program's default plan. `roles` overlays the pair per orchestrator sub-task
 * role; the linear router always resolves `role = 'default'`.
 */
export interface Route {
  router: RouterName;
  runner: RunnerName;
  model: ModelAlias;
  roles?: Record<string, Partial<Pair>>;
}

/** The shared default plan. Every program points here until it overrides. */
export const DEFAULT_ROUTE: Route = {
  router: Sequence.linear,
  runner: Harness.anthropic,
  model: 'sonnet',
};

/**
 * Per-program routing — every registered program is listed. `Partial`, not
 * `Record`: `ProgramId` widens to `string`, so the type can't force coverage —
 * the `runner-plan` test keeps this in lockstep with `PROGRAM_REGISTRY`. Today
 * every program runs `DEFAULT_ROUTE` (linear / anthropic / sonnet); moving one
 * is a single value, e.g. `'self-driving': { ...DEFAULT_ROUTE, runner: 'pi' }`.
 * Anything absent falls back to `DEFAULT_ROUTE` in `resolvePair`.
 */
export const ROUTES: Partial<Record<ProgramId, Route>> = {
  'posthog-integration': DEFAULT_ROUTE,
  'revenue-analytics-setup': DEFAULT_ROUTE,
  'warehouse-source': DEFAULT_ROUTE,
  'error-tracking-upload-source-maps': DEFAULT_ROUTE,
  audit: DEFAULT_ROUTE,
  'events-audit': DEFAULT_ROUTE,
  'posthog-doctor': DEFAULT_ROUTE,
  'web-analytics-doctor': DEFAULT_ROUTE,
  migration: DEFAULT_ROUTE,
  'self-driving': DEFAULT_ROUTE,
  'agent-skill': DEFAULT_ROUTE,
  'mcp-add': DEFAULT_ROUTE,
  'mcp-remove': DEFAULT_ROUTE,
  'mcp-tutorial': DEFAULT_ROUTE,
  'mcp-analytics': DEFAULT_ROUTE,
  slack: DEFAULT_ROUTE,
};

/** Everything a resolver middleware may branch on. Built once per run. */
export interface ResolveCtx {
  program: ProgramId;
  flags: Record<string, string>;
  /** CLI override (`--harness` / `POSTHOG_WIZARD_HARNESS`). Wins over `flags`. */
  cliHarness?: Harness;
}

/** A resolver middleware: defer via `next()`, or assert by returning a value. */
export type Mw<D> = (ctx: ResolveCtx, next: () => D) => D;

/** Run a middleware chain over `ctx`, terminating in `base` (the map read). */
export function runChain<D>(chain: Mw<D>[], ctx: ResolveCtx, base: () => D): D {
  const dispatch = (i: number): D =>
    i < chain.length ? chain[i](ctx, () => dispatch(i + 1)) : base();
  return dispatch(0);
}

/**
 * The pair insertion point. The chain is empty until the flag middleware lands;
 * the terminal is the config map read. Called per leaf with a role.
 */
/**
 * PostHog `wizard-runner` flag → override the resolved pair's runner. Model
 * always stays from config. Defers-then-modifies: takes the base pair, then
 * overlays the runner field iff the flag names a known harness.
 */
const flagRunnerOverride: Mw<Pair> = (ctx, next) => {
  const pair = next();
  const flag = ctx.flags[WIZARD_RUNNER_FLAG_KEY];
  return flag === Harness.anthropic || flag === Harness.pi
    ? { ...pair, runner: flag }
    : pair;
};

/**
 * CLI `--harness` override. Sits ahead of `flagRunnerOverride` in the chain so
 * it wraps — and therefore wins over — the flag result. Dev/test only: the
 * option that populates `ctx.cliHarness` is gated out of published builds (see
 * wizard.ts), and this entry is dropped from the chain below in prod, so the
 * override path is unreachable and tree-shaken there.
 */
const cliHarnessOverride: Mw<Pair> = (ctx, next) => {
  const pair = next();
  return ctx.cliHarness ? { ...pair, runner: ctx.cliHarness } : pair;
};

// Order = priority: the first entry wraps the rest, so it has the last word.
// `IS_PRODUCTION_BUILD` inlines to `true` in published builds, collapsing the
// spread to `[]` and leaving `cliHarnessOverride` unreferenced for rolldown to
// drop.
const PAIR_MIDDLEWARE: Mw<Pair>[] = [
  ...(IS_PRODUCTION_BUILD ? [] : [cliHarnessOverride]),
  flagRunnerOverride,
];

export function resolvePair(ctx: ResolveCtx, role = 'default'): Pair {
  const pair = runChain(PAIR_MIDDLEWARE, ctx, () => {
    const route = ROUTES[ctx.program] ?? DEFAULT_ROUTE;
    return { runner: route.runner, model: route.model, ...route.roles?.[role] };
  });
  logToFile(
    `[runner] resolved: program=${ctx.program} runner=${pair.runner} model=${
      MODELS[pair.model]
    }`,
  );
  return pair;
}
