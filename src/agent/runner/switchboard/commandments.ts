/**
 * System-prompt commandments, keyed by the axes the switchboard resolves.
 *
 * Programs select their guidance before the run; the agent assembles that
 * supplied text with global, sequence, model and harness guidance.
 *
 * Leaf module by design — it imports the axis enums and the per-axis text, never
 * a runner or a harness backend, so the harnesses can call the assembler without
 * an import cycle.
 */

import { Harness, Sequence } from '@shared/config/constants';
import { WIZARD_COMMANDMENTS } from '../../prompt/commandments';
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
  /** Deprecated call-site label; never used to select guidance. */
  program?: string;
  /** Selected by programs; the agent only assembles supplied text. */
  programCommandments?: readonly string[];
  sequence: Sequence;
  harness: Harness;
  /** Gateway model id. */
  model?: string;
  /** Which tools this session actually mounted. Harness notes only; finer than the axes. */
  caps?: RuntimeCaps;
}

/** Every commandment this run's axes call for, broad to narrow. */
export function assembleCommandments(axes: CommandmentAxes): string {
  const { programCommandments, sequence, harness, model, caps } = axes;
  const harnessNotes = HARNESS_NOTES[harness]?.(
    sequence,
    caps ?? { bash: true, posthogMcp: true },
  );
  return [
    ...WIZARD_COMMANDMENTS,
    ...(programCommandments ?? []),
    ...SEQUENCE_COMMANDMENTS[sequence],
    ...(model ? MODEL_COMMANDMENTS[model] ?? [] : []),
    // Blank line first: the notes open their own `## This runtime` section.
    harnessNotes && `\n${harnessNotes}`,
  ]
    .filter(Boolean)
    .join('\n');
}
