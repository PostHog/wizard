/**
 * Sequence axis: gate helpers, registry, middleware, resolver.
 * Percentage rollouts are PostHog-side — the gate just reads the resolved bool.
 */

import { IS_PRODUCTION_BUILD } from '@env';
import {
  Harness,
  Sequence,
  WIZARD_ORCHESTRATOR_FLAG_KEY,
} from '@lib/constants';
import { logToFile } from '@utils/debug';
import { resolveHarness } from './harness';
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

/** The `wizard-orchestrator` flag is on. */
export function isOrchestratorEnabled(
  flags: Record<string, string> = {},
): boolean {
  return flags[WIZARD_ORCHESTRATOR_FLAG_KEY] === 'true';
}

/** `--sequence` override. Dev/test only — the option is gated out of published builds. */
const cliSequenceMw: Middleware<Sequence> = (ctx, next) =>
  ctx.cliSequence ?? next();

/** PostHog `wizard-orchestrator` flag → orchestrator. */
const orchestratorFeatureFlagMw: Middleware<Sequence> = (ctx, next) =>
  isOrchestratorEnabled(ctx.flags) ? Sequence.orchestrator : next();

/**
 * pi has no `runTask`, so orchestrator mode throws on it. When the harness
 * axis resolves to pi (the `wizard-use-pi-harness` flag), clamp the flag-driven
 * sequence to linear so `wizard-use-pi-harness` + `wizard-orchestrator` can
 * never combine into a crashing cohort. Sits BELOW the CLI override — a dev
 * build forcing `--sequence orchestrator` still reproduces the hard error.
 */
const piLinearClampMw: Middleware<Sequence> = (ctx, next) => {
  if (resolveHarness(ctx).harness !== Harness.pi) return next();
  if (isOrchestratorEnabled(ctx.flags)) {
    logToFile(
      '[switchboard] wizard-orchestrator ignored: pi has no runTask, clamping to linear',
    );
  }
  return Sequence.linear;
};

// Order = precedence: CLI > pi clamp > flag > binding default. The prod spread
// collapses to [], dropping cliSequenceMw from the chain.
const SEQUENCE_MIDDLEWARE: Middleware<Sequence>[] = [
  ...(IS_PRODUCTION_BUILD ? [] : [cliSequenceMw]),
  piLinearClampMw,
  orchestratorFeatureFlagMw,
];

/** CLI wins over `wizard-orchestrator` flag wins over binding default. */
export function resolveSequence(ctx: SwitchboardCtx): Sequence {
  const sequence = runChain(SEQUENCE_MIDDLEWARE, ctx, () => {
    const binding = PROGRAM_BINDINGS[ctx.program] ?? DEFAULT_BINDING;
    return binding.sequence;
  });
  logToFile(
    `[switchboard] resolved: program=${ctx.program} sequence=${sequence}`,
  );
  return sequence;
}
