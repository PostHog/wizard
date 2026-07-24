/**
 * Harness axis: registry, middleware, resolver. Mirrors `sequence.ts`.
 */

import { IS_PRODUCTION_BUILD } from '@env';
import { Harness } from '@lib/constants';
import { logToFile } from '@utils/debug';
import { anthropicBackend } from '../harness/anthropic';
import { piBackend } from '../harness/pi';
import type { AgentHarness } from '../harness/types';
import { resolveFlagRoute } from './flags';
import {
  DEFAULT_BINDING,
  PROGRAM_BINDINGS,
  runChain,
  type HarnessPick,
  type Middleware,
  type SwitchboardCtx,
} from '.';

export const HARNESS_OPTIONS: Partial<Record<Harness, AgentHarness>> = {
  [Harness.anthropic]: anthropicBackend,
  [Harness.pi]: piBackend,
};

export function getHarness(name: Harness): AgentHarness {
  const harness = HARNESS_OPTIONS[name];
  if (!harness) {
    throw new Error(`No harness registered for '${name}'.`);
  }
  return harness;
}

/**
 * PostHog-flag routing to pi (see `./flags`). No valid route — flag off, no
 * config, or an invalid payload — keeps the non-flagged binding default.
 */
const flagRunnerOverride: Middleware<HarnessPick> = (ctx, next) => {
  const pick = next();
  const route = resolveFlagRoute(ctx.program, ctx.flags, ctx.flagPayloads);
  if (!route) return pick;
  if (ctx.trace) Object.assign(ctx.trace, { harness: 'flag', model: 'flag' });
  return {
    harness: route.harness ?? Harness.pi,
    model: route.model ?? pick.model,
    thinkingLevel: route.thinkingLevel,
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
    const binding = PROGRAM_BINDINGS[ctx.program] ?? DEFAULT_BINDING;
    return {
      harness: binding.harness,
      model: binding.model,
      thinkingLevel: binding.thinkingLevel,
      ...binding.contextMillOverride?.[role],
    };
  });
  logToFile(
    `[switchboard] resolved: program=${ctx.program} harness=${pick.harness}` +
      `${ctx.trace?.harness ? ` (${ctx.trace.harness})` : ''} model=${
        pick.model
      }` +
      `${ctx.trace?.model ? ` (${ctx.trace.model})` : ''}`,
  );
  return pick;
}
