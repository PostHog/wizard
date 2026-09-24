/**
 * Sequence axis: the registry. Programs resolve which sequence a run uses.
 */

import { Sequence } from '@shared/constants';
import type { SequenceResult, SequenceContext } from '../shared/types';
import { runLinearProgram } from '../sequence/linear';
import { runOrchestrator } from '../sequence/orchestrator/orchestrator-runner';

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
