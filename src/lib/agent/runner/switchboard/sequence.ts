/**
 * Sequence axis: gate helpers, registry, middleware, resolver.
 * Percentage rollouts are PostHog-side — the gate just reads the resolved bool.
 */

import { IS_PRODUCTION_BUILD } from '@env';
import {
  Sequence,
  WIZARD_CLOUD_AUDIT_FLAG_KEY,
  WIZARD_ORCHESTRATOR_FLAG_KEY,
} from '@lib/constants';
import { logToFile } from '@utils/debug';
import { CLOUD_AUDIT_PROGRAMS, getHarness, resolveHarness } from './harness';
import type { WizardSession } from '@lib/wizard-session';
import type { ProgramConfig } from '@lib/programs/program-step';
import type { ProgramRun, BootstrapResult } from '../shared/types';
import { runLinearProgram } from '../sequence/linear';
import { runRemoteProgram } from '../sequence/remote';
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
  [Sequence.remote]: {
    name: Sequence.remote,
    run: (session, config, programConfig, boot, composed) =>
      runRemoteProgram(session, config, programConfig, boot, composed),
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
const cliSequenceMw: Middleware<Sequence> = (ctx, next) => {
  if (!ctx.cliSequence) return next();
  if (ctx.trace) ctx.trace.sequence = 'cli';
  return ctx.cliSequence;
};

/** PostHog `wizard-orchestrator` flag → orchestrator. */
const orchestratorFeatureFlagMw: Middleware<Sequence> = (ctx, next) => {
  if (!isOrchestratorEnabled(ctx.flags)) return next();
  if (ctx.trace) ctx.trace.sequence = 'flag';
  return Sequence.orchestrator;
};

/** PostHog `wizard-cloud-audit` flag → the `remote` sequence, on programs that declare a remote arm. */
const cloudAuditFeatureFlagMw: Middleware<Sequence> = (ctx, next) => {
  if (ctx.flags[WIZARD_CLOUD_AUDIT_FLAG_KEY] !== 'true') return next();
  if (!CLOUD_AUDIT_PROGRAMS.has(ctx.program)) return next();
  if (ctx.trace) ctx.trace.sequence = 'flag';
  return Sequence.remote;
};

/**
 * The orchestrator drives harnesses through `runTask`; a harness that has not
 * implemented it clamps the run back to linear. Only orchestrator needs
 * `runTask` — linear and remote never go through the queue — so this defers to
 * the rest of the chain first and only intervenes when the resolved sequence is
 * orchestrator. A capability check, not a harness identity check: a harness
 * gains orchestrator support by implementing the method, no switchboard change.
 * Sits below the CLI override so `--sequence orchestrator` still reproduces the
 * hard error in dev builds.
 */
const runTaskCapabilityClampMw: Middleware<Sequence> = (ctx, next) => {
  const picked = next();
  if (picked !== Sequence.orchestrator) return picked;
  const pick = resolveHarness(ctx);
  if (getHarness(pick.harness).runTask) return picked;
  logToFile(
    `[switchboard] wizard-orchestrator ignored: ${pick.harness} has no runTask, clamping to linear`,
  );
  if (ctx.trace) ctx.trace.sequence = 'runtask-clamp';
  return Sequence.linear;
};

// Order = precedence: CLI > capability clamp > flag > binding default. The
// prod spread collapses to [], dropping cliSequenceMw from the chain.
const SEQUENCE_MIDDLEWARE: Middleware<Sequence>[] = [
  ...(IS_PRODUCTION_BUILD ? [] : [cliSequenceMw]),
  runTaskCapabilityClampMw,
  cloudAuditFeatureFlagMw,
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
