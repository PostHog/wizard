/**
 * Sequence axis: gate helpers, registry, middleware, resolver.
 * Percentage rollouts are PostHog-side — the gate just reads the resolved bool.
 */

import { IS_PRODUCTION_BUILD } from '@env';
import { Sequence, WIZARD_ORCHESTRATOR_FLAG_KEY } from '@lib/constants';
import { logToFile } from '@utils/debug';
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
  ): Promise<void>;
}

export const SEQUENCE_OPTIONS: Partial<Record<Sequence, SequenceRunner>> = {
  [Sequence.linear]: {
    name: Sequence.linear,
    run: (session, config, programConfig, boot) =>
      runLinearProgram(session, config, programConfig, boot),
  },
  [Sequence.orchestrator]: {
    name: Sequence.orchestrator,
    run: (session, _config, programConfig, boot) =>
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

// Order = precedence: CLI > flag > binding default. The prod spread collapses
// to [], dropping cliSequenceMw from the chain.
const SEQUENCE_MIDDLEWARE: Middleware<Sequence>[] = [
  ...(IS_PRODUCTION_BUILD ? [] : [cliSequenceMw]),
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
