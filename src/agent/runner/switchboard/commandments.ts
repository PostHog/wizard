/**
 * System-prompt commandments, keyed by the axes the switchboard resolves.
 *
 * A run is a resolved (program, sequence, harness, model). Guidance belongs to
 * whichever axis makes it true, declared here beside the tables that resolve
 * them, and assembled once by `assembleCommandments`. A rule that is true for
 * every run stays in `@agent/commandments`; anything narrower lives here so
 * the call sites never re-derive it.
 *
 * Leaf module by design — it imports the axis enums and the per-axis text, never
 * a runner or a harness backend, so the harnesses can call the assembler without
 * an import cycle.
 */

import { Harness, Sequence } from '@shared/constants';
import { WIZARD_COMMANDMENTS } from '../../commandments';
import { piRuntimeNotes, type RuntimeCaps } from '../harness/pi/runtime-notes';
import { LINEAR_COMMANDMENTS } from './linear-commandments';

// ── Sequence axis ───────────────────────────────────────────────────────

const SEQUENCE_COMMANDMENTS: Record<Sequence, readonly string[]> = {
  [Sequence.linear]: LINEAR_COMMANDMENTS,
  [Sequence.orchestrator]: [],
};

// ── Program axis ────────────────────────────────────────────────────────

const SELF_DRIVING = [
  'ALWAYS surface a custom-scout proposal in step 6b: bring the user your one or two strongest candidate scouts even when the built-in troop looks sufficient. The proposal ask leads with a "None — keep the built-in troop" option, so declining costs the user one keystroke — but a proposal you silently skip is coverage they never got to see or judge. Where the skill says to skip the ask when the gap analysis finds no candidate, do NOT skip: pick your best candidates anyway and let the user decide.',

  'Rank candidates at the discriminator level, not the category level. "Covered" only means an enabled scout would actually FIRE for that failure mode: a conversion-rate watcher does not catch entry volume collapsing; a Stripe-transaction watcher does not catch a lead form going silent. A surface whose failure mode has no firing condition among the enabled scouts is your strongest candidate.',

  'Be honest in the option descriptions: if a candidate overlaps something an enabled scout partially watches, say so in its description rather than dropping the candidate. The user chooses with full information; you do not gatekeep on their behalf.',
];

const PROGRAM_COMMANDMENTS: Record<string, readonly string[]> = {
  'self-driving': SELF_DRIVING,
};

// ── Harness axis ────────────────────────────────────────────────────────

/**
 * A harness contributes the guidance its own tools make true, so it needs the
 * sequence and the session's caps. The anthropic harness has no entry: its
 * `claude_code` preset already carries its tool semantics.
 */
const HARNESS_NOTES: Partial<
  Record<Harness, (sequence: Sequence, caps: RuntimeCaps) => string>
> = {
  [Harness.pi]: piRuntimeNotes,
};

// ── Model axis ──────────────────────────────────────────────────────────

/** Per-model guidance. Empty — no model needs its own steering yet. */
const MODEL_COMMANDMENTS: Record<string, readonly string[]> = {};

// ── Assembly ────────────────────────────────────────────────────────────

export interface CommandmentAxes {
  /** The run's program id. */
  program?: string;
  sequence: Sequence;
  harness: Harness;
  /** Gateway model id. */
  model?: string;
  /** Which tools this session actually mounted. Harness notes only; finer than the axes. */
  caps?: RuntimeCaps;
}

/** Every commandment this run's axes call for, broad to narrow. */
export function assembleCommandments(axes: CommandmentAxes): string {
  const { program, sequence, harness, model, caps } = axes;
  const harnessNotes = HARNESS_NOTES[harness]?.(
    sequence,
    caps ?? { bash: true, posthogMcp: true },
  );
  return [
    ...WIZARD_COMMANDMENTS,
    ...(program ? PROGRAM_COMMANDMENTS[program] ?? [] : []),
    ...SEQUENCE_COMMANDMENTS[sequence],
    ...(model ? MODEL_COMMANDMENTS[model] ?? [] : []),
    // Blank line first: the notes open their own `## This runtime` section.
    harnessNotes && `\n${harnessNotes}`,
  ]
    .filter(Boolean)
    .join('\n');
}
