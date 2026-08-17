/**
 * System-prompt commandments, keyed by the axes the switchboard resolves.
 *
 * A run is a resolved (program, sequence, harness, model). Guidance belongs to
 * whichever axis makes it true, declared here beside the tables that resolve
 * them, and assembled once by `assembleCommandments`. A rule that is true for
 * every run stays in `@lib/agent/commandments`; anything narrower lives here so
 * the call sites never re-derive it.
 *
 * Leaf module by design — it imports the axis enums and the per-axis text, never
 * a runner or a harness backend, so the harnesses can call the assembler without
 * an import cycle.
 */

import { Harness, Sequence } from '@lib/constants';
import { WIZARD_COMMANDMENTS } from '@lib/agent/commandments';
import { piRuntimeNotes, type RuntimeCaps } from '../harness/pi/runtime-notes';

// ── Sequence axis ───────────────────────────────────────────────────────

/**
 * LINEAR only. One session drives the whole run and holds the Task tools; an
 * orchestrator task session holds none of them and reports through
 * `complete_task`, so naming them there only earns a "no task tool available"
 * remark. True on every harness — both mount the Task tools on linear and
 * neither does for a task session.
 */
const TASK_LIST_MANAGEMENT = [
  'Use the Task tools to plan and track the whole run so the user always sees where you are. Create the task list once you understand the work — after you load and skim the skill workflow, not before — in a single tool call, in the order you will run them, with one task per stage covering the whole run through to instrumenting events, creating the dashboard, and writing the setup report. Give each an imperative subject AND an `activeForm` (the present-continuous label the panel shows while it runs, e.g. subject "Install SDK" / activeForm "Installing SDK"). Keep the list current: add a task the moment you discover work it is missing.',

  'Try to keep exactly ONE task `in_progress`. `TaskUpdate` it to `in_progress` right before you start that stage, and to `completed` the instant you finish it — one at a time, never batched at the end. Only mark `completed` when the work is genuinely done; if the build fails, a step is partial, or you hit a blocker, keep it `in_progress` and add a task for the fix.',

  'After you complete a task, take the next one in order (lowest id first — earlier stages set up later ones), mark it `in_progress`, and continue. Driving the list in order top to bottom is how you finish every stage.',

  'Each task subject is SHORT — a few words naming only the stage of work: "Analyze project", "Install SDK", "Initialize PostHog", "Instrument events", "Set env vars", "Verify", "Create dashboard". No file or directory names, no framework/router/package names, no specific event names, and no parenthetical "(...)" detail. The detail belongs in the work and the `activeForm`, not the subject.',
];

const SEQUENCE_COMMANDMENTS: Record<Sequence, readonly string[]> = {
  [Sequence.linear]: TASK_LIST_MANAGEMENT,
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
  /** Program id, as resolved into `PROGRAM_BINDINGS`. */
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
