/**
 * Harness axis: registry, middleware, resolver. Mirrors `sequence.ts`.
 */

import { IS_PRODUCTION_BUILD } from '@env';
import {
  GPT5_MINI_MODEL,
  Harness,
  WIZARD_USE_PI_HARNESS_FLAG_KEY,
} from '@lib/constants';
import { logToFile } from '@utils/debug';
import { anthropicBackend } from '../harness/anthropic';
import { piBackend } from '../harness/pi';
import type { AgentHarness } from '../harness/types';
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
 * `wizard-use-pi-harness` flag on → pi paired with the cheap/fast gpt-5-mini.
 * Off/missing → binding default (anthropic + sonnet). A `--model` CLI override
 * still wins — it overlays after this in the chain.
 */
const flagRunnerOverride: Middleware<HarnessPick> = (ctx, next) => {
  const pick = next();
  if (ctx.flags[WIZARD_USE_PI_HARNESS_FLAG_KEY] !== 'true') return pick;
  return { harness: Harness.pi, model: GPT5_MINI_MODEL };
};

/** `--harness` override. Dev/test only — the option is gated out of published builds. */
const cliHarnessOverride: Middleware<HarnessPick> = (ctx, next) => {
  const pick = next();
  return ctx.cliHarness ? { ...pick, harness: ctx.cliHarness } : pick;
};

/** `--model` override. Dev/test only — the option is gated out of published builds. */
const cliModelOverride: Middleware<HarnessPick> = (ctx, next) => {
  const pick = next();
  return ctx.cliModel ? { ...pick, model: ctx.cliModel } : pick;
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
    const binding = PROGRAM_BINDINGS[ctx.program] ?? DEFAULT_BINDING;
    return {
      harness: binding.harness,
      model: binding.model,
      ...binding.contextMillOverride?.[role],
    };
  });
  logToFile(
    `[switchboard] resolved: program=${ctx.program} harness=${pick.harness} model=${pick.model}`,
  );
  return pick;
}
