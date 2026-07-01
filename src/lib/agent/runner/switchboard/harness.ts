/**
 * Harness axis: registry, middleware, resolver. Mirrors `sequence.ts`.
 */

import { Harness, WIZARD_RUNNER_FLAG_KEY } from '@lib/constants';
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

/** CLI wins over `wizard-runner` flag; model always stays from binding. */
const wizardRunner: Middleware<HarnessPick> = (ctx, next) => {
  const pick = next();
  if (ctx.cliHarness) return { ...pick, harness: ctx.cliHarness };
  const flag = ctx.flags[WIZARD_RUNNER_FLAG_KEY];
  return flag === Harness.anthropic || flag === Harness.pi
    ? { ...pick, harness: flag }
    : pick;
};

/**
 * **Order = precedence** (see `sequence.ts` for the full explanation). Single
 * entry here today — `wizardRunner` defers-then-overlays, so CLI > flag >
 * binding precedence is enforced inside the middleware itself, not by the
 * array position.
 */
const HARNESS_MIDDLEWARE: Middleware<HarnessPick>[] = [wizardRunner];

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
