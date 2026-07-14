/**
 * Harness axis: registry, middleware, resolver. Mirrors `sequence.ts`.
 */

import { IS_PRODUCTION_BUILD, RUN_SURFACE } from '@env';
import {
  DEFAULT_AGENT_MODEL,
  GPT5_4_MODEL,
  GPT5_5_MODEL,
  GPT5_6_LUNA_MODEL,
  GPT5_6_SOL_MODEL,
  GPT5_6_TERRA_MODEL,
  GPT5_MINI_MODEL,
  GPT5_MODEL,
  Harness,
  SONNET_5_MODEL,
} from '@lib/constants';
import { logToFile } from '@utils/debug';
import { anthropicBackend } from '../harness/anthropic';
import { piBackend } from '../harness/pi';
import type { AgentHarness } from '../harness/types';
import type { EffortLevel } from './models';
import { PI_FLAG_CONFIGS } from './pi-flags';
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
 * Model-flag variant key → gateway id (variant keys can't carry `/` or `.`).
 * Shared vocabulary for every trio's `modelFlag` in `PI_FLAG_CONFIGS`.
 */
const PI_MODEL_FLAG_VARIANTS: Record<string, string> = {
  'gpt-5': GPT5_MODEL,
  'gpt-5-4': GPT5_4_MODEL,
  'gpt-5-mini': GPT5_MINI_MODEL,
  'gpt-5-5': GPT5_5_MODEL,
  'gpt-5-6-luna': GPT5_6_LUNA_MODEL,
  'gpt-5-6-terra': GPT5_6_TERRA_MODEL,
  'gpt-5-6-sol': GPT5_6_SOL_MODEL,
  'sonnet-4-6': DEFAULT_AGENT_MODEL,
  'sonnet-5': SONNET_5_MODEL,
};

/** Valid effort-flag variants; anything else leaves the model's table default. */
const EFFORT_FLAG_VARIANTS: readonly EffortLevel[] = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
];

/**
 * The program's `useFlag` on → pi, paired with its `modelFlag` variant
 * (unknown/missing variant → the config's fallback model) and its `effortFlag`
 * as the resolved thinking level (invalid/missing → none). A program without
 * a `PI_FLAG_CONFIGS` entry ignores the flags and the binding default stands.
 */
const flagRunnerOverride: Middleware<HarnessPick> = (ctx, next) => {
  const pick = next();
  const cfg = PI_FLAG_CONFIGS[ctx.program];
  if (!cfg) return pick;
  if (ctx.flags[cfg.useFlag] !== 'true') return pick;
  // The pi experiment is disabled on the cloud (headless) run surface.
  if (RUN_SURFACE === 'cloud') return pick;
  if (ctx.trace) Object.assign(ctx.trace, { harness: 'flag', model: 'flag' });
  const variant = ctx.flags[cfg.modelFlag] ?? '';
  const effort = ctx.flags[cfg.effortFlag] as EffortLevel;
  return {
    harness: Harness.pi,
    model: PI_MODEL_FLAG_VARIANTS[variant] ?? cfg.fallbackModel,
    thinkingLevel: EFFORT_FLAG_VARIANTS.includes(effort) ? effort : undefined,
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
