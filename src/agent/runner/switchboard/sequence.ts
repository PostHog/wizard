/**
 * Sequence axis: registry, clamps and generic resolution of caller-supplied policy.
 */

import { IS_PRODUCTION_BUILD } from '@env';
import { Sequence } from '@shared/constants';
import { logToFile } from '@utils/debug';
import { getHarness, resolveHarness } from './harness';
import type { SequenceResult, SequenceContext } from '../shared/types';
import { runLinearProgram } from '../sequence/linear';
import { runOrchestrator } from '../sequence/orchestrator/orchestrator-runner';
import {
  DEFAULT_BINDING,
  runChain,
  type Middleware,
  type SwitchboardCtx,
} from '.';

// ── Registry ────────────────────────────────────────────────────────────

export interface SequenceRunner {
  readonly name: Sequence;
  /** Run one program to a decided result. Unexpected errors propagate. */
  run(ctx: SequenceContext): Promise<SequenceResult>;
}

export const SEQUENCE_OPTIONS: Partial<Record<Sequence, SequenceRunner>> = {
  [Sequence.linear]: {
    name: Sequence.linear,
    run: (ctx) => runLinearProgram(ctx),
  },
  [Sequence.orchestrator]: {
    name: Sequence.orchestrator,
    run: (ctx) => runOrchestrator(ctx),
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

/**
 * A composed sub-run (integration inside self-driving) is structurally
 * linear: the orchestrator owns the full run lifecycle (queue, outro) and
 * cannot nest. Sits above every override, including CLI.
 */
const composedClampMw: Middleware<Sequence> = (ctx, next) => {
  if (!ctx.composed) return next();
  if (ctx.trace) ctx.trace.sequence = 'composed';
  return Sequence.linear;
};

/** `--sequence` override. Dev/test only — the option is gated out of published builds. */
const cliSequenceMw: Middleware<Sequence> = (ctx, next) => {
  if (!ctx.cliSequence) return next();
  if (ctx.trace) ctx.trace.sequence = 'cli';
  return ctx.cliSequence;
};

/** A caller-supplied payload route may pin the sequence. */
const flagRouteSequenceMw: Middleware<Sequence> = (ctx, next) => {
  const route = ctx.flagRoute;
  if (!route?.sequence) return next();
  if (ctx.trace) ctx.trace.sequence = 'payload';
  return route.sequence;
};

/** A caller-supplied sequence experiment, already scoped to its program. */
const sequenceExperimentMw: Middleware<Sequence> = (ctx, next) => {
  const sequence = ctx.flagSequence;
  if (!sequence) return next();
  if (ctx.trace) ctx.trace.sequence = 'flag';
  return sequence;
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
  if (ctx.orchestratorFlagOn) {
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
  composedClampMw,
  ...(IS_PRODUCTION_BUILD ? [] : [cliSequenceMw]),
  runTaskCapabilityClampMw,
  flagRouteSequenceMw,
  sequenceExperimentMw,
];

/** CLI wins over `wizard-orchestrator` flag wins over binding default. */
export function resolveSequence(ctx: SwitchboardCtx): Sequence {
  const sequence = runChain(SEQUENCE_MIDDLEWARE, ctx, () => {
    if (ctx.trace) ctx.trace.sequence = 'binding';
    const binding = ctx.baseBinding ?? DEFAULT_BINDING;
    return binding.sequence;
  });
  logToFile(
    `[switchboard] resolved: program=${
      ctx.program ?? '?'
    } sequence=${sequence}` +
      `${ctx.trace?.sequence ? ` (${ctx.trace.sequence})` : ''}`,
  );
  return sequence;
}
