/**
 * Linear-only commandments.
 *
 * Only `Sequence.linear` runs mount the Task* todo tools (`TaskCreate`,
 * `TaskUpdate`, `TaskGet`, `TaskList`) to drive the TUI progress panel and
 * completion guard. Orchestrator tasks report through `complete_task` and
 * never mount Task* tools, so none of this guidance may reach an orchestrator
 * session.
 */

export const LINEAR_TASK_LIST_COMMANDMENTS: readonly string[] = [
  'Use the Task tools to plan and track the whole run so the user always sees where you are. Create the task list once you understand the work — after you load and skim the skill workflow, not before — in a single tool call, in the order you will run them, with one task per stage covering the whole run through to instrumenting events, creating the dashboard, and writing the setup report. Give each an imperative subject AND an `activeForm` (the present-continuous label the panel shows while it runs, e.g. subject "Install SDK" / activeForm "Installing SDK"). Keep the list current: add a task the moment you discover work it is missing.',

  'Try to keep exactly ONE task `in_progress`. `TaskUpdate` it to `in_progress` right before you start that stage, and to `completed` the instant you finish it — one at a time, never batched at the end. Never spend a whole turn on `TaskUpdate` alone: when transitioning between stages, pair `TaskUpdate` (`completed` for the finished stage and `in_progress` for the next) with the next stage’s first tool call in the same turn. Only mark `completed` when the work is genuinely done; if the build fails, a step is partial, or you hit a blocker, keep it `in_progress` and add a task for the fix.',

  'After you complete a task, take the next one in order (lowest id first — earlier stages set up later ones), mark it `in_progress`, and continue. Driving the list in order top to bottom is how you finish every stage.',

  'Each task subject is SHORT — a few words naming only the stage of work: "Analyze project", "Install SDK", "Initialize PostHog", "Instrument events", "Set env vars", "Verify", "Create dashboard". No file or directory names, no framework/router/package names, no specific event names, and no parenthetical "(...)" detail. The detail belongs in the work and the `activeForm`, not the subject.',
];

export const LINEAR_COMMANDMENTS: readonly string[] = [
  ...LINEAR_TASK_LIST_COMMANDMENTS,
];
