// Resolves routing; model additions also require mint allowlists and gateway prompt/transport support.

import { Harness, Sequence } from '@shared/constants';
import type { EffortLevel } from './models';

// ── Shared machinery ────────────────────────────────────────────────────

/** Which precedence rung decided each axis. Stamped by the resolvers as they decide. */
export interface SwitchboardTrace {
  harness?: 'cli' | 'flag' | 'binding';
  model?: 'cli' | 'flag' | 'binding';
  sequence?:
    | 'cli'
    | 'composed'
    | 'runtask-clamp'
    | 'payload'
    | 'flag'
    | 'binding';
}

/** Everything a resolver may branch on. Built once per run. */
export interface SwitchboardCtx {
  /** Opaque log label. Program lookup stays with the caller. */
  program?: string;
  /** The caller's selected base binding, before route/CLI overlays. */
  baseBinding?: ProgramBinding;
  /** Composed sub-run (a dependency inside a parent program). Structurally linear — no override can orchestrate it. */
  composed?: boolean;
  /** Already validated experiment route; no flag parsing happens in the agent. */
  flagRoute?: {
    harness?: Harness;
    model?: string;
    thinkingLevel?: EffortLevel;
    sequence?: Sequence;
  };
  /** CLI override (`--harness`). Wins over `flags`. */
  cliHarness?: Harness;
  /** CLI override (`--sequence`). Wins over `flags`. */
  cliSequence?: Sequence;
  /** CLI override (`--model`, gateway id). Wins over the binding's model. */
  cliModel?: string;
  /** Filled during resolution; read by the caller for telemetry. */
  trace?: SwitchboardTrace;
}

// ── Data model ──────────────────────────────────────────────────────────

/** Harness + model for one leaf of agent work. */
export interface HarnessPick {
  harness: Harness;
  /** Gateway model id (string). */
  model: string;
  /** Reasoning-effort override. Absent → the model's table default. */
  thinkingLevel?: EffortLevel;
}

export interface ProgramBinding {
  sequence: Sequence;
  harness: Harness;
  model: string;
  /** Reasoning-effort override for the model. Absent → the model's table default. */
  thinkingLevel?: EffortLevel;
  /**
   * Per-role overrides applied only in orchestrator mode — keys are
   * agent-prompt `type` values published by context-mill (`'seed'`,
   * `'install'`, `'capture'`, etc.). Linear runs use role `'default'` and
   * skip this map.
   */
  contextMillOverride?: Record<string, Partial<HarnessPick>>;
}

// ── Unified re-export surface ───────────────────────────────────────────
export { HARNESS_OPTIONS, getHarness } from './harness';
export {
  harnessRunsTasks,
  resolveHarness,
  resolveRoleHarness,
} from './resolve-harness';
export { SEQUENCE_OPTIONS, getSequence, type SequenceRunner } from './sequence';
