/**
 * Sequence axis: gate helpers, registry, middleware, resolver.
 * Percentage rollouts are PostHog-side — the gate just reads the resolved bool.
 */

import { IS_PRODUCTION_BUILD } from '@env';
import { Sequence } from '@lib/constants';
import { logToFile } from '@utils/debug';
import { isOrchestratorEnabled, resolveFlagRoute } from './flags';
import { getHarness, resolveHarness } from './harness';
import type { WizardSession } from '@lib/wizard-session';
import type { ProgramConfig } from '@lib/programs/program-step';
import type { ProgramRun, BootstrapResult } from '../shared/types';
import { runLinearProgram } from '../sequence/linear';
import { runOrchestrator } from '../sequence/orchestrator/orchestrator-runner';
import {
  DEFAULT_BINDING,
  PROGRAM_BINDINGS,
  runChain,
  type Middleware,
  type SwitchboardCtx,
} from '.';

// ── Registry ────────────────────────────────────────────────────────────

export interface SequenceRunner {
  readonly name: Sequence;
  run(
    session: WizardSession,
    config: ProgramRun,
    programConfig: ProgramConfig,
    boot: BootstrapResult,
    /** Composed sub-run (integration inside self-driving); linear-only. */
    composed: boolean,
  ): Promise<void>;
}

export const SEQUENCE_OPTIONS: Partial<Record<Sequence, SequenceRunner>> = {
  [Sequence.linear]: {
    name: Sequence.linear,
    run: (session, config, programConfig, boot, composed) =>
      runLinearProgram(session, config, programConfig, boot, composed),
  },
  [Sequence.orchestrator]: {
    name: Sequence.orchestrator,
    run: (session, _config, programConfig, boot, _composed) =>
      runOrchestrator(session, programConfig, boot),
  },
};

export function getSequence(name: Sequence): SequenceRunner {
  const sequence = SEQUENCE_OPTIONS[name];
  if (!sequence) {
    throw new Error(`No sequence registered for '${name}'.`);
  }
  return sequence;
}

// ── Middleware + resolver ───────────────────────────────────────────────

/** `--sequence` override. Dev/test only — the option is gated out of published builds. */
const cliSequenceMw: Middleware<Sequence> = (ctx, next) => {
  if (!ctx.cliSequence) return next();
  if (ctx.trace) ctx.trace.sequence = 'cli';
  return ctx.cliSequence;
};

/** A program's own flag route may pin the sequence; wins over the global orchestrator flag. */
const flagRouteSequenceMw: Middleware<Sequence> = (ctx, next) => {
  const route = resolveFlagRoute(ctx.program, ctx.flags, ctx.flagPayloads);
  if (!route?.sequence) return next();
  if (ctx.trace) ctx.trace.sequence = 'flag';
  return route.sequence;
};

/** PostHog `wizard-orchestrator` flag → orchestrator. */
const orchestratorFeatureFlagMw: Middleware<Sequence> = (ctx, next) => {
  if (!isOrchestratorEnabled(ctx.flags)) return next();
  if (ctx.trace) ctx.trace.sequence = 'flag';
  return Sequence.orchestrator;
};

/**
 * The orchestrator drives harnesses through `runTask`; a harness that has not
 * implemented it clamps the run to linear. A capability check, not a harness
 * identity check — a harness gains orchestrator support by implementing the
 * method, with no switchboard change. Sits below the CLI override so
 * `--sequence orchestrator` still reproduces the hard error in dev builds.
 */
const runTaskCapabilityClampMw: Middleware<Sequence> = (ctx, next) => {
  const pick = resolveHarness(ctx);
  if (getHarness(pick.harness).runTask) return next();
  if (isOrchestratorEnabled(ctx.flags)) {
    logToFile(
      `[switchboard] wizard-orchestrator ignored: ${pick.harness} has no runTask, clamping to linear`,
    );
  }
  if (ctx.trace) ctx.trace.sequence = 'runtask-clamp';
  return Sequence.linear;
};

// Order = precedence: CLI > capability clamp > flag > binding default. The
// prod spread collapses to [], dropping cliSequenceMw from the chain.
const SEQUENCE_MIDDLEWARE: Middleware<Sequence>[] = [
  ...(IS_PRODUCTION_BUILD ? [] : [cliSequenceMw]),
  runTaskCapabilityClampMw,
  flagRouteSequenceMw,
  orchestratorFeatureFlagMw,
];

/** CLI wins over `wizard-orchestrator` flag wins over binding default. */
export function resolveSequence(ctx: SwitchboardCtx): Sequence {
  const sequence = runChain(SEQUENCE_MIDDLEWARE, ctx, () => {
    if (ctx.trace) ctx.trace.sequence = 'binding';
    const binding = PROGRAM_BINDINGS[ctx.program] ?? DEFAULT_BINDING;
    return binding.sequence;
  });
  logToFile(
    `[switchboard] resolved: program=${ctx.program} sequence=${sequence}` +
      `${ctx.trace?.sequence ? ` (${ctx.trace.sequence})` : ''}`,
  );
  return sequence;
}
