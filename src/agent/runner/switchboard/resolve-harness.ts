/**
 * Harness axis: the resolver that picks a harness and model, and which
 * harnesses the orchestrator can drive. Data and pure functions only, so the
 * agent entry loads this at startup; the registry is `harness.ts`.
 */

import { IS_PRODUCTION_BUILD } from '@env';
import { Harness } from '@shared/constants';
import { logToFile } from '@utils/debug';
import { DEFAULT_AGENT_BINDING } from '@agent/default-binding';
import type { ResolvedBinding } from '../shared/types';
import type { HarnessPick, ProgramBinding, SwitchboardCtx } from '.';

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
 * Resolve the harness for a role. Linear callers omit `role`; orchestrator
 * callers pass `'seed'` or `task.type`. `contextMillOverride[role]` overlays.
 * Precedence: CLI > flag route > binding default; the CLI overrides are
 * dev/test only and gated out of published builds.
 */
export function resolveHarness(
  ctx: SwitchboardCtx,
  role = 'default',
): HarnessPick {
  if (ctx.trace)
    Object.assign(ctx.trace, { harness: 'binding', model: 'binding' });
  const binding: ProgramBinding = ctx.baseBinding ?? DEFAULT_AGENT_BINDING;
  let pick: HarnessPick = {
    harness: binding.harness,
    model: binding.model,
    thinkingLevel: binding.thinkingLevel,
    ...binding.contextMillOverride?.[role],
  };
  const route = ctx.flagRoute;
  if (route) {
    if (ctx.trace) {
      ctx.trace.harness = 'flag';
      // Harness-only routes keep the binding's model — trace it truthfully so
      // analytics never attributes the fallback model to the flag.
      if (route.model) ctx.trace.model = 'flag';
    }
    pick = {
      harness: route.harness ?? Harness.pi,
      model: route.model ?? pick.model,
      thinkingLevel: route.thinkingLevel ?? pick.thinkingLevel,
    };
  }
  if (!IS_PRODUCTION_BUILD && ctx.cliModel) {
    if (ctx.trace) ctx.trace.model = 'cli';
    pick = { ...pick, model: ctx.cliModel };
  }
  if (!IS_PRODUCTION_BUILD && ctx.cliHarness) {
    if (ctx.trace) ctx.trace.harness = 'cli';
    pick = { ...pick, harness: ctx.cliHarness };
  }
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
  binding: ResolvedBinding,
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
