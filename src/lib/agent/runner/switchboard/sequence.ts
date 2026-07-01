/**
 * Sequence axis: gate helpers, registry, middleware, resolver.
 * Percentage rollouts are PostHog-side — the gate just reads the resolved bool.
 */

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

const cliSequenceMw: Middleware<Sequence> = (ctx, next) =>
  ctx.cliSequence ?? next();

/**
 * PostHog handles rollout percentages server-side; we just read the resolved
 * value for this user. The `wizard-orchestrator` flag can be either:
 *   - **boolean** (`'true'` → orchestrator) — current shape
 *   - **multivariate** (`'linear'` | `'orchestrator'` → asserts that value) —
 *     if we later want an explicit A/B split with named variants
 * Anything else defers to the next middleware / fallback.
 */
const orchestratorFeatureFlagMw: Middleware<Sequence> = (ctx, next) =>
  ctx.flags[WIZARD_ORCHESTRATOR_FLAG_KEY] === 'true'
    ? Sequence.orchestrator
    : next();

/**
 * **Order = precedence.** The first entry runs first and either short-circuits
 * (asserts a sequence value) or defers via `next()` to the next entry. The fallback in
 * `resolveSequence` runs only if every middleware deferred.
 *
 *   [0] cliSequenceMw       — CLI `--sequence` (highest priority)
 *   [1] orchestratorFeatureFlagMw  — PostHog `wizard-orchestrator` flag
 *       fallback            — binding default (lowest priority)
 */
const SEQUENCE_MIDDLEWARE: Middleware<Sequence>[] = [
  cliSequenceMw,
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
