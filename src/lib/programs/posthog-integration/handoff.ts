/**
 * The one-line prompt the operator pastes into their own coding agent after a
 * run: open the setup-report notebook, work its "Verify before merging"
 * checklist. Surfaced via `OutroData.handoffPrompt` (printed to scrollback on
 * exit); only exists when the run captured a notebook URL, since no report
 * file is written. The wording demands investigate-then-approval, and stops
 * there — the operator's own agent governs how changes land. Background:
 * https://github.com/PostHog/wizard/issues/447
 */
export function buildCodingAgentPrompt(notebookUrl: string): string {
  return `Open ${notebookUrl} (the PostHog setup report) and work through its "Verify before merging" checklist: investigate each item, then list the changes you'd make and get my approval before applying any of them.`;
}
