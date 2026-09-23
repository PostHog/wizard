/**
 * Harness axis: the middleware chain that picks a harness and model, and which
 * harnesses the orchestrator can drive. Data and pure functions only, so the
 * agent entry loads this at startup; the registry is `harness.ts`.
 */

import { IS_PRODUCTION_BUILD } from '@env';
import { Harness } from '@shared/constants';
import { logToFile } from '@utils/debug';
import { DEFAULT_AGENT_BINDING } from '@agent/default-binding';
import type {
  HarnessPick,
  Middleware,
  ProgramBinding,
  SwitchboardCtx,
} from '.';

/** Which backends implement `runTask`; a registry test keeps this in step with HARNESS_OPTIONS. */
export const HARNESS_RUNS_TASKS: Record<Harness, boolean> = {
  [Harness.anthropic]: true,
  [Harness.pi]: true,
};

/** Whether the orchestrator can drive this harness. */
export function harnessRunsTasks(name: Harness): boolean {
  return HARNESS_RUNS_TASKS[name] === true;
}

/**
 * Run a middleware chain over `ctx`. Each middleware receives `next` (which
 * runs the rest of the chain) and can either:
 *   - defer: call `next()` and optionally modify its result (overlay pattern)
 *   - short-circuit: return a value without calling `next()` (skip the rest)
 *
 * **Earlier in the array = higher precedence.** Index 0 runs first and can
 * short-circuit the rest; index 1 only runs if index 0 deferred. An overlay
 * earlier in the array applies last, so `[cliHarnessOverride,
 * flagRunnerOverride]` means CLI takes precedence over the flag.
 *
 * `fallback` runs at the end — reached only when every middleware deferred.
 * Typically the map read for the base value.
 */
function runChain<D>(
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

/**
 * A validated caller-supplied route overlays the base binding.
 */
const flagRunnerOverride: Middleware<HarnessPick> = (ctx, next) => {
  const pick = next();
  const route = ctx.flagRoute;
  if (!route) return pick;
  if (ctx.trace) {
    ctx.trace.harness = 'flag';
    // Harness-only routes keep the binding's model — trace it truthfully so
    // analytics never attributes the fallback model to the flag.
    if (route.model) ctx.trace.model = 'flag';
  }
  return {
    harness: route.harness ?? Harness.pi,
    model: route.model ?? pick.model,
    thinkingLevel: route.thinkingLevel ?? pick.thinkingLevel,
  };
};

/** `--harness` override. Dev/test only — the option is gated out of published builds. */
const cliHarnessOverride: Middleware<HarnessPick> = (ctx, next) => {
  const pick = next();
  if (!ctx.cliHarness) return pick;
  if (ctx.trace) ctx.trace.harness = 'cli';
  return { ...pick, harness: ctx.cliHarness };
};

/** `--model` override. Dev/test only — the option is gated out of published builds. */
const cliModelOverride: Middleware<HarnessPick> = (ctx, next) => {
  const pick = next();
  if (!ctx.cliModel) return pick;
  if (ctx.trace) ctx.trace.model = 'cli';
  return { ...pick, model: ctx.cliModel };
};

// Order = precedence: CLI > flag > binding default. The prod spread collapses
// to [], dropping the CLI overrides from the chain.
const HARNESS_MIDDLEWARE: Middleware<HarnessPick>[] = [
  ...(IS_PRODUCTION_BUILD ? [] : [cliHarnessOverride, cliModelOverride]),
  flagRunnerOverride,
];

/**
 * Resolve the harness for a role. Linear callers omit `role`; orchestrator
 * callers pass `'seed'` or `task.type`. `contextMillOverride[role]` overlays.
 */
export function resolveHarness(
  ctx: SwitchboardCtx,
  role = 'default',
): HarnessPick {
  const pick = runChain(HARNESS_MIDDLEWARE, ctx, () => {
    if (ctx.trace)
      Object.assign(ctx.trace, { harness: 'binding', model: 'binding' });
    const binding: ProgramBinding = ctx.baseBinding ?? DEFAULT_AGENT_BINDING;
    return {
      harness: binding.harness,
      model: binding.model,
      thinkingLevel: binding.thinkingLevel,
      ...binding.contextMillOverride?.[role],
    };
  });
  logToFile(
    `[switchboard] resolved: program=${ctx.program ?? '?'} harness=${
      pick.harness
    }` +
      `${ctx.trace?.harness ? ` (${ctx.trace.harness})` : ''} model=${
        pick.model
      }` +
      `${ctx.trace?.model ? ` (${ctx.trace.model})` : ''}`,
  );
  return pick;
}

/** The agent resolves a task role only from data the caller already supplied. */
export function resolveRoleHarness(
  binding: {
    harness: Harness;
    model: string;
    thinkingLevel?: HarnessPick['thinkingLevel'];
    roleBindings?: Record<string, HarnessPick>;
  },
  role: string,
): HarnessPick {
  return (
    binding.roleBindings?.[role] ?? {
      harness: binding.harness,
      model: binding.model,
      thinkingLevel: binding.thinkingLevel,
    }
  );
}
